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
}

const FUNCTION_TYPE = "function";

type Root = RootComposition;

export function resetSessionState(state: SessionState): void {
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
	void root.publisher.publishSessionDeactivated();
	root.promptQueue.reset();
	root.sessionState.sessionId = null;
	root.sessionState.gitState = {};
	root.sessionState.moduleState = {};
	root.setSession(null);
	root.footer.deactivate();
	root.worktree.deactivate();
	root.exitProtocol.deactivate();
	queueMicrotask(() => resetSessionState(root.sessionState));
}

function deactivateUnconfigured(root: Root): void {
	const hadSession = root.getSession() !== null;
	if (hadSession) deactivate(root);
	else {
		void root.publisher.publishSessionDeactivated();
		root.pr.deactivateSession();
		root.footer.deactivate();
		root.worktree.deactivate();
		root.exitProtocol.deactivate();
	}
	resetSessionState(root.sessionState);
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

async function activateConfigured(
	root: Root,
	event: SessionStartEvent,
	ctx: ExtensionContext,
	project: { codingRoot: string; todoistProjectRef: string },
	config: TodoistProjectMapping,
): Promise<{ session: PrSession; branch: readonly unknown[] }> {
	root.exitProtocol.sessionStart(ctx);
	await root.worktree.sessionStart(ctx);
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
	const handoffContext = inherited.handoffContext;
	await root.footer.sessionStart(
		handoffContext ? event : { ...event, previousSessionFile: undefined },
		ctx,
	);
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
	await root.publisher.publishSessionActivated({ context: ctx });
	return { session, branch };
}

async function persistInitialPr(
	root: Root,
	branch: readonly unknown[],
): Promise<void> {
	const session = root.getSession();
	if (session?.allowPrDiscovery !== true) return;
	await root.pr.persistInitialPr(branch);
}

export async function handleSessionStart(
	root: Root,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	deactivateUnconfigured(root);
	await root.publisher.publishSessionReset();
	const config = await (root.dependencies.loadConfig ?? loadConfig)();
	const project = resolveConfiguredProject(ctx.cwd, config);
	if (project === null) {
		deactivateUnconfigured(root);
		return;
	}
	const { session, branch } = await activateConfigured(
		root,
		event,
		ctx,
		project,
		config,
	);
	root.registerStateTool(() => root.getSession());
	manageActiveTools(root);
	if (ctx.mode === C.value.tui) ctx.ui.setFooter(undefined);
	await persistInitialPr(root, branch);
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
): void {
	let updateQueue = Promise.resolve();
	events.moduleStateChangedEvent.subscribe((update) => {
		const queued = updateQueue.then(async () => {
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
	root.pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, root));
}

export type RootPublisher = RootEventPublisher;
