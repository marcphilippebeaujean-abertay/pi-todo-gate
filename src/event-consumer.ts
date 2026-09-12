import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RootEventPublisher } from "./event-publishers.ts";
import type { ExitProtocolModule } from "./exit-protocol/state.ts";
import { refreshFooterStatuses } from "./footer/module.ts";
import type { FooterModule as FooterModuleType } from "./footer/state.ts";
import type { PrModule, PrSession } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResultEvent,
	EventHandler,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "./shared/events.ts";
import { latestStateData, textOf } from "./shared/extension-message.ts";
import type { SessionReader, WorkState } from "./shared/session-state.ts";
import {
	extractInheritedState,
	latestState,
	type SessionState,
} from "./state.ts";
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
	getSession: () => PrSession | null;
	setSession: (session: PrSession | null) => void;
	registered: () => boolean;
	registerStateTool: (getSession: () => PrSession | null) => void;
	publisher: RootEventPublisher;
	lifecycleEpoch: { value: number };
}

const FUNCTION_TYPE = "function";

type Root = RootComposition;

const resetEpochs = new WeakMap<SessionState, number>();

export function resetSessionState(state: SessionState): void {
	resetEpochs.set(state, (resetEpochs.get(state) ?? 0) + 1);
	state.sessionId = null;
	state.gitState = {};
	state.moduleState = {};
}

export function publishModuleState(
	root: Root,
	moduleId: string,
	moduleState: Record<string, unknown>,
): void {
	void root.eventHandler.moduleStateChangedEvent.emit({
		moduleId,
		moduleState,
	});
}

export function appendState(
	root: Root,
	state: WorkState,
	prDiscoveryDisabled?: boolean,
): void {
	publishModuleState(root, C.module.work, { ...state });
	const shouldDisableDiscovery = prDiscoveryDisabled ?? false;
	const data = shouldDisableDiscovery
		? { ...state, prDiscoveryDisabled: true }
		: state;
	root.pi.appendEntry(C.entry.state, data);
}

export function replaceSessionState(
	session: PrSession,
	nextState: WorkState,
): void {
	const hasTaskChanged = session.state.taskRef !== nextState.taskRef;
	const hasPrChanged = session.state.prUrl !== nextState.prUrl;
	if (hasTaskChanged || hasPrChanged) session.workRevision += 1;
	session.state = nextState;
}

function deactivate(root: Root): void {
	const session = root.getSession();
	const hasSession = session !== null;
	if (hasSession) session.operationGeneration += 1;
	root.pr.deactivateSession();
	root.setSession(null);
	resetSessionState(root.sessionState);
	void root.publisher.publishSessionDeactivated();
	root.promptQueue.reset();
	root.worktree.deactivate();
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
	stateEntry: Record<string, unknown> | null,
	state: WorkState,
): { state: WorkState; handoffContext: boolean } {
	const hasStateEntry = stateEntry !== null;
	const previousSessionFile = event.previousSessionFile;
	const hasPreviousSession = previousSessionFile !== undefined;
	if (hasStateEntry || !hasPreviousSession)
		return { state, handoffContext: false };
	const previous: SessionReader =
		root.dependencies.openSession?.(previousSessionFile) ??
		SessionManager.open(previousSessionFile);
	const previousProject = resolveConfiguredProject(previous.getCwd(), config);
	const sameCodingProject = previousProject?.codingRoot === project.codingRoot;
	const inherited = sameCodingProject
		? extractInheritedState(previous.getBranch())
		: null;
	if (inherited === null) return { state, handoffContext: false };
	const inheritedState = {
		...inherited,
		inheritedFrom: previous.getSessionId(),
	};
	appendState(root, inheritedState);
	return { state: inheritedState, handoffContext: true };
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
	if (!root.registered() || active.includes(C.tool.state)) return;
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
): Promise<{ session: PrSession; branch: readonly unknown[] } | null> {
	root.exitProtocol.sessionStart(ctx);
	await root.worktree.sessionStart(ctx);
	if (!isCurrentEpoch(root, epoch)) return null;
	const branch = ctx.sessionManager.getBranch();
	const stateEntry = latestStateData(branch, C.entry.state);
	let state = latestState(branch);
	const inherited = inheritPreviousState(
		root,
		event,
		config,
		project,
		stateEntry,
		state,
	);
	state = await root.pr.initializeRemoteOrigin(ctx, inherited.state);
	if (!isCurrentEpoch(root, epoch)) return null;
	const handoffContext = inherited.handoffContext;
	await root.footer.sessionStart(
		handoffContext ? event : { ...event, previousSessionFile: undefined },
		ctx,
	);
	if (!isCurrentEpoch(root, epoch)) return null;
	const session: PrSession = {
		sessionId: ctx.sessionManager.getSessionId(),
		context: ctx,
		project,
		state,
		allowPrDiscovery: root.pr.isDiscoveryAllowed(
			stateEntry,
			state,
			handoffContext,
		),
		prDiscoveryTestedUrls: new Set<string>(),
		handoffContext,
		workChanged: false,
		hasUncommittedChanges: false,
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
	};
	root.sessionState.sessionId = session.sessionId;
	root.setSession(session);
	publishModuleState(root, C.module.work, { ...state });
	await root.pr.activateSession(session);
	if (!isCurrentEpoch(root, epoch)) return null;
	await root.publisher.publishSessionActivated({ context: ctx });
	if (!isCurrentEpoch(root, epoch)) return null;
	return { session, branch };
}

async function persistInitialPr(
	root: Root,
	epoch: number,
	branch: readonly unknown[],
): Promise<void> {
	const session = root.getSession();
	if (session?.allowPrDiscovery !== true || !isCurrentEpoch(root, epoch))
		return;
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
		resetSessionState(root.sessionState);
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
	const { session, branch } = activated;
	root.registerStateTool(() => root.getSession());
	manageActiveTools(root);
	if (ctx.mode === C.value.tui) ctx.ui.setFooter(undefined);
	await persistInitialPr(root, epoch, branch);
	if (!isCurrentEpoch(root, epoch)) return;
	session.hasUncommittedChanges = root.worktree.getHasUncommittedChanges();
	refreshFooterStatuses(root.footer, session);
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
	const session = root.getSession();
	if (session === null) return undefined;
	const messages: string[] = [];
	if (session.handoffContext) {
		messages.push(
			`This is the task and PR that we were working on.\nTask: ${session.state.taskUrl ?? C.value.none}\nPR: ${session.state.prUrl ?? C.value.none}`,
		);
		session.handoffContext = false;
	}
	if (session.state.taskRef === undefined)
		root.todoist.maybeAnalyzeTaskClaim(session, event.prompt);
	if (session.workChanged) await root.pr.appendBeforeAgentPrompt(ctx, messages);
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
	resetSessionState(root.sessionState);
}

export function updateModuleState(
	state: SessionState,
	update: import("./shared/events.ts").ModuleStateChangedEvent,
): void {
	state.moduleState[update.moduleId] = structuredClone(update.moduleState);
	if (update.gitStatePatch !== undefined)
		state.gitState = {
			...state.gitState,
			...structuredClone(update.gitStatePatch),
		};
}

export async function applyModuleStateChanged(
	state: SessionState,
	update: import("./shared/events.ts").ModuleStateChangedEvent,
): Promise<void> {
	updateModuleState(state, update);
}

export function registerModuleStateConsumer(
	events: EventHandler,
	state: SessionState,
	acceptUpdate?: () => boolean,
): void {
	let updateQueue = Promise.resolve();
	events.moduleStateChangedEvent.subscribe((update) => {
		const acceptedAtEmission = acceptUpdate?.() ?? true;
		const updateEpoch = resetEpochs.get(state) ?? 0;
		const queued = updateQueue.then(async () => {
			if (!acceptedAtEmission || updateEpoch !== (resetEpochs.get(state) ?? 0))
				return;
			const previousState = structuredClone(state);
			updateModuleState(state, update);
			const currentState = structuredClone(state);
			await events.sessionStateChangedEvent.emit({
				previousState,
				currentState,
			});
		});
		updateQueue = queued.catch(() => undefined);
		return queued;
	});
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
	root.eventHandler.worktreeStatusEvent.subscribe(
		({ context, hasUncommittedChanges }) => {
			const session = root.getSession();
			const isCurrent = session !== null && session.context === context;
			if (!isCurrent || session === null) return;
			session.hasUncommittedChanges = hasUncommittedChanges;
			refreshFooterStatuses(root.footer, session);
		},
	);
	root.pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, root));
}

export type RootPublisher = RootEventPublisher;
