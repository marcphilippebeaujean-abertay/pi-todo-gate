import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RootEventPublisher } from "./event-publishers.ts";
import type { ExitProtocolModule } from "./exit-protocol/state.ts";
import type { FooterModule as FooterModuleType } from "./footer/state.ts";
import type { PrModule, PrSession } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import type { ModuleStateDescriptors } from "./session-state-persistence.ts";
import {
	latestPersistedSessionState,
	restoreSessionState,
} from "./session-state-persistence.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResultEvent,
	EventHandler,
	MessageEndEvent,
	ModuleStateChangedEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "./shared/events.ts";
import { textOf } from "./shared/extension-message.ts";
import type { SessionReader } from "./shared/session-state.ts";
import { createSessionState, type SessionState } from "./state.ts";
import { loadConfig, resolveConfiguredProject } from "./todoist/config.ts";
import type { TodoistModule, TodoistProjectMapping } from "./todoist/state.ts";
import type { WorktreeModule } from "./worktree/state.ts";

export interface RootComposition {
	pi: ExtensionAPI;
	dependencies: {
		loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
		openSession?: (path: string) => SessionReader;
	};
	eventHandler: EventHandler;
	promptQueue: PromptQueue;
	sessionState: SessionState;
	footer: FooterModuleType;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: WorktreeModule;
	exitProtocol: ExitProtocolModule;
	session: PrSession | null;
	publisher: RootEventPublisher;
	lifecycleEpoch: { value: number };
	stateUpdateEpoch: { value: number };
	stateUpdatesDrained: () => Promise<void>;
	stateDescriptors: ModuleStateDescriptors;
	persistSessionState: (state: SessionState) => void | Promise<void>;
}

const FUNCTION_TYPE = "function";

type Root = RootComposition;

export interface StateUpdateEpoch {
	value: number;
}

export function resetSessionState(
	state: SessionState,
	epoch?: StateUpdateEpoch,
): void {
	if (epoch !== undefined) epoch.value += 1;
	state.session.activeSessionId = null;
	delete state.session.inheritedFromSessionId;
	state.gitState = {};
	state.moduleState = createSessionState().moduleState;
}

export function publishModuleState<K extends import("./state.ts").ModuleId>(
	root: Root,
	moduleId: K,
	moduleState: import("./state.ts").ModuleState[K],
	options: {
		persist: boolean;
		gitStatePatch?: Partial<import("./state.ts").GitState>;
	},
): void {
	void root.eventHandler.moduleStateChangedEvent.emit({
		moduleId,
		moduleState,
		persist: options.persist,
		...(options.gitStatePatch === undefined
			? {}
			: { gitStatePatch: options.gitStatePatch }),
	} as ModuleStateChangedEvent);
}

function deactivate(root: Root): void {
	const session = root.session;
	const hasSession = session !== null && session !== undefined;
	if (hasSession) session.operationGeneration += 1;
	root.session = null;
	resetSessionState(root.sessionState, root.stateUpdateEpoch);
	void root.publisher.publishSessionDeactivated();
	root.promptQueue.reset();
}

function deactivateUnconfigured(root: Root): void {
	deactivate(root);
	manageActiveTools(root, true);
}

function inheritPreviousState(
	root: Root,
	event: SessionStartEvent,
	config: TodoistProjectMapping,
	project: { codingRoot: string },
	hasCurrentSnapshot: boolean,
	state: SessionState,
): { state: SessionState; hasPendingHandoffContext: boolean } {
	const previousSessionFile = event.previousSessionFile;
	const hasPreviousSession = previousSessionFile !== undefined;
	if (hasCurrentSnapshot || !hasPreviousSession)
		return { state, hasPendingHandoffContext: false };
	const previous: SessionReader =
		root.dependencies.openSession?.(previousSessionFile) ??
		SessionManager.open(previousSessionFile);
	const previousProject = resolveConfiguredProject(previous.getCwd(), config);
	const sameCodingProject = previousProject?.codingRoot === project.codingRoot;
	if (!sameCodingProject) return { state, hasPendingHandoffContext: false };
	const persisted = latestPersistedSessionState(previous.getBranch());
	if (persisted === null) return { state, hasPendingHandoffContext: false };
	const inheritedState = restoreSessionState(persisted, root.stateDescriptors);
	inheritedState.session.inheritedFromSessionId = previous.getSessionId();
	return { state: inheritedState, hasPendingHandoffContext: true };
}

function manageActiveTools(root: Root, remove?: boolean): void {
	const shouldRemove = remove ?? false;
	const canManage =
		typeof root.pi.getActiveTools === FUNCTION_TYPE &&
		typeof root.pi.setActiveTools === FUNCTION_TYPE;
	if (!canManage) return;
	const active = root.pi.getActiveTools();
	if (shouldRemove) {
		root.pi.setActiveTools(active.filter((name) => name !== C.tool.state));
		return;
	}
	if (active.includes(C.tool.state)) return;
	root.pi.setActiveTools([...active, C.tool.state]);
}

function isCurrentEpoch(root: Root, epoch: number): boolean {
	return root.lifecycleEpoch.value === epoch;
}

async function activateConfigured(
	root: Root,
	epoch: number,
	event: SessionStartEvent,
	ctx: ExtensionContext,
	project: { codingRoot: string; todoistProjectRef: string },
	config: TodoistProjectMapping,
): Promise<{
	session: PrSession;
	branch: readonly unknown[];
	hasPendingHandoffContext: boolean;
} | null> {
	const branch = ctx.sessionManager.getBranch();
	const persisted = latestPersistedSessionState(branch);
	const restored =
		persisted === null
			? createSessionState()
			: restoreSessionState(persisted, root.stateDescriptors);
	const inherited = inheritPreviousState(
		root,
		event,
		config,
		project,
		persisted !== null,
		restored,
	);
	const state = inherited.state;
	root.sessionState.session = {
		...state.session,
		activeSessionId: ctx.sessionManager.getSessionId(),
	};
	root.sessionState.gitState = state.gitState;
	root.sessionState.moduleState = state.moduleState;
	const hasPendingHandoffContext = inherited.hasPendingHandoffContext;
	const session: PrSession = {
		context: ctx,
		project,
		hasPendingHandoffContext,
		hasPerformedAnyGitMutations: false,
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
	};
	root.session = session;
	await root.publisher.publishSessionActivated({
		context: ctx,
		previousSessionFile: hasPendingHandoffContext
			? event.previousSessionFile
			: undefined,
		session,
		lifecycleEpoch: epoch,
	});
	if (!isCurrentEpoch(root, epoch)) return null;
	await root.pr.initializeRemoteOrigin(
		ctx,
		root.sessionState.gitState.remoteOrigin,
	);
	if (!isCurrentEpoch(root, epoch)) return null;
	return { session, branch, hasPendingHandoffContext };
}

async function persistInheritedState(
	root: Root,
	epoch: number,
	hasPendingHandoffContext: boolean,
): Promise<boolean> {
	if (!hasPendingHandoffContext) return true;
	if (!isCurrentEpoch(root, epoch)) return false;
	await root.persistSessionState(root.sessionState);
	await root.stateUpdatesDrained();
	return isCurrentEpoch(root, epoch);
}

async function persistInitialPr(
	root: Root,
	epoch: number,
	branch: readonly unknown[],
): Promise<void> {
	const prState = root.sessionState.moduleState.pr;
	const canDiscover = !prState.discoveryDisabled && prState.prUrl === undefined;
	if (!canDiscover || !isCurrentEpoch(root, epoch)) return;
	await root.pr.persistInitialPr(branch);
	if (!isCurrentEpoch(root, epoch)) return;
}

export async function handleSessionStart(
	root: Root,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const epoch = root.lifecycleEpoch.value + 1;
	root.lifecycleEpoch.value = epoch;
	deactivateUnconfigured(root);
	await root.publisher.publishSessionReset();
	if (!isCurrentEpoch(root, epoch)) return;
	const config = await (root.dependencies.loadConfig ?? loadConfig)();
	if (!isCurrentEpoch(root, epoch)) return;
	const project = resolveConfiguredProject(ctx.cwd, config);
	if (project === null) {
		resetSessionState(root.sessionState, root.stateUpdateEpoch);
		manageActiveTools(root, true);
		return;
	}
	const activated = await activateConfigured(
		root,
		epoch,
		event,
		ctx,
		project,
		config,
	);
	if (activated === null || !isCurrentEpoch(root, epoch)) return;
	const { branch, hasPendingHandoffContext } = activated;
	await root.stateUpdatesDrained();
	if (!isCurrentEpoch(root, epoch)) return;
	const inheritedStateReady = await persistInheritedState(
		root,
		epoch,
		hasPendingHandoffContext,
	);
	if (!inheritedStateReady) return;
	manageActiveTools(root);
	if (ctx.mode === C.value.tui) ctx.ui.setFooter(undefined);
	await persistInitialPr(root, epoch, branch);
	if (!isCurrentEpoch(root, epoch)) return;
}

export async function handleMessageEnd(
	root: Root,
	event: MessageEndEvent,
): Promise<void> {
	await root.pr.persistPrIfAvailable(textOf(event.message));
}

export async function handleBeforeAgentStart(
	root: Root,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<BeforeAgentStartResultEvent | undefined> {
	const session = root.session;
	if (session === null) return undefined;
	const messages: string[] = [];
	if (session.hasPendingHandoffContext) {
		const todoistState = root.sessionState.moduleState.todoist;
		const prState = root.sessionState.moduleState.pr;
		messages.push(
			`This is the task and PR that we were working on.\nTask: ${todoistState.taskUrl ?? C.value.none}\nPR: ${prState.prUrl ?? C.value.none}`,
		);
		session.hasPendingHandoffContext = false;
	}
	if (root.sessionState.moduleState.todoist.taskRef === undefined)
		root.todoist.maybeAnalyzeTaskClaim(session, event.prompt);
	if (session.hasPerformedAnyGitMutations)
		await root.pr.appendBeforeAgentPrompt(ctx, messages);
	if (messages.length === 0) return undefined;
	return {
		message: {
			customType: C.message.context,
			content: messages.join("\n"),
			display: false,
		},
	};
}

export function handleSessionShutdown(root: Root): void {
	root.lifecycleEpoch.value += 1;
	deactivate(root);
}

export function updateModuleState(
	state: SessionState,
	update: ModuleStateChangedEvent,
): void {
	switch (update.moduleId) {
		case "pr":
			state.moduleState.pr = structuredClone(update.moduleState);
			break;
		case "todoist":
			state.moduleState.todoist = structuredClone(update.moduleState);
			break;
		case "herdr":
			state.moduleState.herdr = structuredClone(update.moduleState);
			break;
		case "worktree":
			state.moduleState.worktree = structuredClone(update.moduleState);
			break;
		case "footer":
			state.moduleState.footer = structuredClone(update.moduleState);
			break;
		case "exitProtocol":
			state.moduleState.exitProtocol = structuredClone(update.moduleState);
			break;
	}
	if (update.gitStatePatch !== undefined)
		state.gitState = {
			...state.gitState,
			...structuredClone(update.gitStatePatch),
		};
}

export async function applyModuleStateChanged(
	state: SessionState,
	update: ModuleStateChangedEvent,
): Promise<void> {
	updateModuleState(state, update);
}

export type PersistSessionState = (state: SessionState) => void | Promise<void>;

export function registerModuleStateConsumer(
	events: EventHandler,
	state: SessionState,
	acceptUpdate?: () => boolean,
	stateUpdateEpoch?: StateUpdateEpoch,
	persistSessionState?: PersistSessionState,
): () => Promise<void> {
	let updateQueue = Promise.resolve();
	events.moduleStateChangedEvent.subscribe((update) => {
		const acceptedAtEmission = acceptUpdate?.() ?? true;
		const updateEpoch = stateUpdateEpoch?.value ?? 0;
		const queued = updateQueue.then(async () => {
			if (!acceptedAtEmission || updateEpoch !== (stateUpdateEpoch?.value ?? 0))
				return;
			const previousState = structuredClone(state);
			updateModuleState(state, update);
			if (update.persist && persistSessionState !== undefined)
				await persistSessionState(structuredClone(state));
			const currentState = structuredClone(state);
			await events.sessionStateChangedEvent.emit({
				previousState,
				currentState,
			});
		});
		updateQueue = queued.catch(() => undefined);
		return queued;
	});
	return () => updateQueue;
}

export function registerExtensionEventConsumers(root: Root): void {
	root.pi.on(C.event.sessionStart, handleSessionStart.bind(null, root));
	root.pi.on(C.event.messageEnd, handleMessageEnd.bind(null, root));
	root.pi.on(C.event.beforeAgentStart, handleBeforeAgentStart.bind(null, root));
	root.pi.on(
		C.event.toolResult,
		(event: ToolResultEvent, context: ExtensionContext) =>
			root.eventHandler.toolResultEvent.emit({ event, context }),
	);
	root.pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, root));
}

export type RootPublisher = RootEventPublisher;
