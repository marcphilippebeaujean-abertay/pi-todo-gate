import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RootEventPublisher } from "./event-publishers.ts";
import type { FooterModule as FooterModuleType } from "./footer/module.ts";
import type { PrModule } from "./pr/module.ts";
import type { ModuleStateDescriptors } from "./session-state-persistence.ts";
import {
	latestPersistedSessionState,
	restoreSessionState,
} from "./session-state-persistence.ts";
import { spawnExec } from "./shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResultEvent,
	EventHandler,
	MessageEndEvent,
	ModuleStateChangedEvent,
	SessionNotificationEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "./shared/events.ts";
import { inspectProject } from "./shared/project.ts";
import type {
	SessionProject,
	SessionReader,
	SessionRecord,
} from "./shared/session-state.ts";
import {
	createSessionState,
	type RootDependencies,
	type SessionState,
} from "./state.ts";
import type { TodoistModule } from "./todoist/module.ts";
import type { WorktreeCleanup } from "./worktree/module.ts";

export interface RootComposition {
	pi: ExtensionAPI;
	dependencies: RootDependencies;
	eventHandler: EventHandler;
	promptQueue: import("./prompt-queue/module.ts").PromptQueueModule;
	sessionState: SessionState;
	footer: FooterModuleType;
	pr: PrModule | null;
	todoist: TodoistModule | null;
	worktree: WorktreeCleanup | null;
	installModules: (project: SessionProject) => void;
	session: SessionRecord | null;
	publisher: RootEventPublisher;
	stateUpdateEpoch: { value: number };
	stateUpdatesDrained: () => Promise<void>;
	stateDescriptors: ModuleStateDescriptors;
	persistSessionState: (state: SessionState) => void | Promise<void>;
}

const FUNCTION_TYPE = "function";

type Root = RootComposition;

function projectHasRemoteOrigin(
	projectInfo: Awaited<ReturnType<typeof inspectProject>>,
): boolean {
	return projectInfo.remoteOrigin !== null;
}

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

function deactivate(root: Root): void {
	root.session = null;
	resetSessionState(root.sessionState, root.stateUpdateEpoch);
	void root.publisher.publishSessionDeactivated();
}

function deactivateUnconfigured(root: Root): void {
	deactivate(root);
	manageActiveTools(root, true);
}

async function inheritPreviousState(
	root: Root,
	event: SessionStartEvent,
	project: SessionProject,
	hasCurrentSnapshot: boolean,
	state: SessionState,
): Promise<{ state: SessionState; hasPendingHandoffContext: boolean }> {
	const previousSessionFile = event.previousSessionFile;
	const hasPreviousSession = previousSessionFile !== undefined;
	if (hasCurrentSnapshot || !hasPreviousSession)
		return { state, hasPendingHandoffContext: false };
	const previous: SessionReader =
		root.dependencies.openSession?.(previousSessionFile) ??
		SessionManager.open(previousSessionFile);
	const previousProject = await resolveConfiguredProject(
		root,
		previous.getCwd(),
	);
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

export function getActiveSessionId(root: Root): string | null {
	return root.sessionState.session.activeSessionId;
}

export function isCurrentSession(root: Root, sessionId: string): boolean {
	return getActiveSessionId(root) === sessionId;
}

async function resolveConfiguredProject(
	root: Root,
	cwd: string,
): Promise<SessionProject | null> {
	const configuredResolver = root.dependencies.resolveConfiguredProject;
	if (configuredResolver !== undefined) return configuredResolver(cwd);
	return null;
}

async function resolveSessionCapabilities(
	root: Root,
	sessionId: string,
	ctx: ExtensionContext,
): Promise<SessionProject | null> {
	const project = await resolveConfiguredProject(root, ctx.cwd);
	const isCurrentAfterTodoist = isCurrentSession(root, sessionId);
	if (!isCurrentAfterTodoist) return null;
	const exec = root.dependencies.exec ?? spawnExec;
	let projectInfo = await inspectProject(exec, ctx.cwd);
	let originAttempts = 1;
	while (!projectHasRemoteOrigin(projectInfo) && originAttempts < 3) {
		const retry = await inspectProject(exec, ctx.cwd);
		if (projectHasRemoteOrigin(retry)) projectInfo = retry;
		originAttempts += 1;
	}
	const isCurrentAfterGit = isCurrentSession(root, sessionId);
	if (!isCurrentAfterGit) return null;
	const hasProjectRoot = projectInfo.root !== null;
	const hasRemoteOrigin = projectHasRemoteOrigin(projectInfo);
	const isGitProject = hasProjectRoot || hasRemoteOrigin;
	const resolvedGitState = root.sessionState.gitState;
	resolvedGitState.isWorktree = projectInfo.isWorktree;
	resolvedGitState.branch = projectInfo.branch;
	resolvedGitState.worktreeRoot = projectInfo.root;
	resolvedGitState.mainRoot = projectInfo.mainRoot;
	if (projectInfo.remoteOrigin !== null)
		resolvedGitState.remoteOrigin = projectInfo.remoteOrigin;
	const sessionProject: SessionProject = project ?? {
		codingRoot: ctx.cwd,
		triggersOnlyOnWorktree: true,
		isTodoistProject: false,
		isGitProject,
	};
	if (project !== null) sessionProject.isTodoistProject = true;
	sessionProject.isGitProject = isGitProject;
	return sessionProject;
}

async function activateConfigured(
	root: Root,
	sessionId: string,
	event: SessionStartEvent,
	ctx: ExtensionContext,
	project: SessionProject,
): Promise<{
	session: SessionRecord;
	branch: readonly unknown[];
	hasPendingHandoffContext: boolean;
	hasResolvedRemoteOrigin: boolean;
} | null> {
	const branch = ctx.sessionManager.getBranch();
	const persisted = latestPersistedSessionState(branch);
	const restored =
		persisted === null
			? createSessionState()
			: restoreSessionState(persisted, root.stateDescriptors);
	const inherited = await inheritPreviousState(
		root,
		event,
		project,
		persisted !== null,
		restored,
	);
	if (!isCurrentSession(root, sessionId)) return null;
	const state = inherited.state;
	const resolvedRemoteOrigin = root.sessionState.gitState.remoteOrigin;
	const hasResolvedRemoteOrigin =
		resolvedRemoteOrigin !== undefined &&
		resolvedRemoteOrigin !== state.gitState.remoteOrigin;
	root.sessionState.session = {
		...state.session,
		activeSessionId: ctx.sessionManager.getSessionId(),
	};
	root.sessionState.gitState = {
		...state.gitState,
		...root.sessionState.gitState,
	};
	root.sessionState.moduleState = state.moduleState;
	const hasPendingHandoffContext = inherited.hasPendingHandoffContext;
	const session: SessionRecord = {
		context: ctx,
		project,
		hasPendingHandoffContext,
		hasPerformedAnyGitMutations: false,
		workRevision: 0,
		operationQueue: Promise.resolve(),
	};
	root.session = session;
	await root.publisher.publishSessionActivated({
		context: ctx,
		previousSessionFile: hasPendingHandoffContext
			? event.previousSessionFile
			: undefined,
		session,
		sessionId,
	});
	if (!isCurrentSession(root, sessionId)) return null;
	return {
		session,
		branch,
		hasPendingHandoffContext,
		hasResolvedRemoteOrigin,
	};
}

async function persistResolvedRemoteOrigin(
	root: Root,
	activated: {
		hasPendingHandoffContext: boolean;
		hasResolvedRemoteOrigin: boolean;
	},
): Promise<void> {
	const shouldPersist =
		activated.hasResolvedRemoteOrigin && !activated.hasPendingHandoffContext;
	if (!shouldPersist) return;
	await root.persistSessionState(root.sessionState);
}

async function persistInheritedState(
	root: Root,
	sessionId: string,
	hasPendingHandoffContext: boolean,
): Promise<boolean> {
	if (!hasPendingHandoffContext) return true;
	if (!isCurrentSession(root, sessionId)) return false;
	await root.persistSessionState(root.sessionState);
	await root.stateUpdatesDrained();
	return isCurrentSession(root, sessionId);
}

async function publishInitialPrDiscovery(
	root: Root,
	sessionId: string,
	branch: readonly unknown[],
): Promise<void> {
	if (!isCurrentSession(root, sessionId)) return;
	await root.eventHandler.initialPrDiscoveryEvent.emit({
		branch,
		sessionId,
	});
}

export async function handleSessionStart(
	root: Root,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const sessionId = ctx.sessionManager.getSessionId();
	deactivateUnconfigured(root);
	root.sessionState.session.activeSessionId = sessionId;
	await root.publisher.publishSessionReset();
	if (!isCurrentSession(root, sessionId)) return;
	const capabilities = await resolveSessionCapabilities(root, sessionId, ctx);
	if (capabilities === null) return;
	root.installModules(capabilities);
	const activated = await activateConfigured(
		root,
		sessionId,
		event,
		ctx,
		capabilities,
	);
	if (activated === null || !isCurrentSession(root, sessionId)) return;
	const { branch, hasPendingHandoffContext, hasResolvedRemoteOrigin } =
		activated;
	const gitProject = capabilities.isGitProject === true;
	await root.stateUpdatesDrained();
	await persistResolvedRemoteOrigin(root, {
		hasPendingHandoffContext,
		hasResolvedRemoteOrigin,
	});
	if (!isCurrentSession(root, sessionId)) return;
	const inheritedStateReady = await persistInheritedState(
		root,
		sessionId,
		hasPendingHandoffContext,
	);
	if (!inheritedStateReady) return;
	manageActiveTools(root, !gitProject);
	if (ctx.mode === C.value.tui) ctx.ui.setFooter(undefined);
	await root.publisher.publishPiToolRegistrationsBecameAvailable({
		pi: root.pi,
	});
	if (!gitProject) return;
	await publishInitialPrDiscovery(root, sessionId, branch);
	if (!isCurrentSession(root, sessionId)) return;
}

export async function handleMessageEnd(
	root: Root,
	event: MessageEndEvent,
): Promise<void> {
	await root.eventHandler.messageEndEvent.emit({ event });
}

export async function handleBeforeAgentStart(
	root: Root,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<BeforeAgentStartResultEvent | undefined> {
	const session = root.session;
	if (session === null) return undefined;
	const sessionId = root.sessionState.session.activeSessionId;
	if (sessionId === null) return undefined;
	const messages: string[] = [];
	if (session.hasPendingHandoffContext) {
		const todoistState = root.sessionState.moduleState.todoist;
		const prState = root.sessionState.moduleState.pr;
		messages.push(
			`This is the task and PR that we were working on.\nTask: ${todoistState.taskUrl ?? C.value.none}\nPR: ${prState.prUrl ?? C.value.none}`,
		);
		session.hasPendingHandoffContext = false;
	}
	await root.eventHandler.beforeAgentStartEvent.emit({
		event,
		context: ctx,
		session,
		sessionId,
		messages,
	});
	if (root.sessionState.session.activeSessionId !== sessionId) return undefined;
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
		case "herdrTabRename":
			state.moduleState.herdrTabRename = structuredClone(update.moduleState);
			break;
		case "worktree":
			state.moduleState.worktree = structuredClone(update.moduleState);
			break;
		case "footer":
			state.moduleState.footer = structuredClone(update.moduleState);
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

function notifySession(
	root: Root,
	notification: SessionNotificationEvent,
): void {
	const session = root.session;
	if (session === null) return;
	try {
		session.context.ui.notify(notification.message, notification.level);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}

export function registerExtensionEventConsumers(root: Root): void {
	const pendingNotifications = new Map<string, SessionNotificationEvent[]>();
	root.eventHandler.sessionNotificationEvent.subscribe((notification) => {
		const activeSessionId = root.sessionState.session.activeSessionId;
		const hasActiveSession = root.session !== null && activeSessionId !== null;
		if (hasActiveSession) {
			notifySession(root, notification);
			return;
		}
		if (activeSessionId === null) return;
		const pending = pendingNotifications.get(activeSessionId) ?? [];
		pending.push(notification);
		pendingNotifications.set(activeSessionId, pending);
	});
	root.eventHandler.sessionActivatedEvent.subscribe(({ sessionId }) => {
		const pending = pendingNotifications.get(sessionId);
		if (pending === undefined) return;
		pendingNotifications.delete(sessionId);
		for (const notification of pending) notifySession(root, notification);
	});
	root.eventHandler.sessionDeactivatedEvent.subscribe(() =>
		pendingNotifications.clear(),
	);
	root.pi.on(C.event.sessionStart, handleSessionStart.bind(null, root));
	root.pi.on(C.event.messageEnd, handleMessageEnd.bind(null, root));
	root.pi.on(C.event.beforeAgentStart, handleBeforeAgentStart.bind(null, root));
	root.pi.on(
		C.event.toolResult,
		(event: ToolResultEvent, context: ExtensionContext) =>
			root.eventHandler.toolResultEvent.emit({
				event,
				context,
				session: root.session ?? undefined,
			}),
	);
	root.pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, root));
}

export type RootPublisher = RootEventPublisher;
