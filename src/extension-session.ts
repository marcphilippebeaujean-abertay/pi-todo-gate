import {
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveConfiguredProject } from "./config.ts";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type { SessionStartEvent } from "./events.ts";
import { persistPrIfAvailable } from "./extension-events.ts";
import {
	appendState,
	deactivateSession,
	initializeRemoteOrigin,
	refreshFooterStatuses,
	resetTemporarySessionState,
} from "./extension-lifecycle.ts";
import { branchTexts, latestStateData } from "./extension-message.ts";
import { installStateTool } from "./extension-tool.ts";
import type {
	ActiveSession,
	ExtensionRuntime,
	SessionReader,
} from "./extension-types.ts";
import { extractInheritedState, latestState } from "./session-state.ts";
import { spawnExec } from "./shared/command.ts";
import { hasUncommittedChanges } from "./shared/project.ts";
import type { TodoistProjectMapping } from "./todoist/module.ts";

const FUNCTION_TYPE = "function";

function deactivateUnconfiguredSession(runtime: ExtensionRuntime): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (hasSession) {
		deactivateSession(runtime, session);
		const canManageActiveTools =
			typeof runtime.pi.getActiveTools === FUNCTION_TYPE &&
			typeof runtime.pi.setActiveTools === FUNCTION_TYPE;
		if (canManageActiveTools) {
			const activeTools = runtime.pi.getActiveTools();
			const remainingTools = activeTools.filter(
				(name) => name !== C.tool.state,
			);
			runtime.pi.setActiveTools(remainingTools);
		}
	}
	if (!hasSession) runtime.footer.deactivate();
	runtime.worktree.deactivate();
	runtime.exitProtocol.deactivate();
	runtime.active = null;
}

function inheritPreviousState(
	runtime: ExtensionRuntime,
	event: SessionStartEvent,
	config: TodoistProjectMapping,
	project: NonNullable<ActiveSession["project"]>,
	stateEntry: Record<string, unknown> | null,
	state: ActiveSession["state"],
): { state: ActiveSession["state"]; handoffContext: boolean } {
	const hasPreviousSession =
		stateEntry === null && event.previousSessionFile !== undefined;
	if (!hasPreviousSession) return { state, handoffContext: false };
	const previousSessionFile = event.previousSessionFile ?? "";
	const previous: SessionReader =
		runtime.dependencies.openSession?.(previousSessionFile) ??
		SessionManager.open(previousSessionFile);
	const previousProject = resolveConfiguredProject(previous.getCwd(), config);
	const sameCodingProject = previousProject?.codingRoot === project.codingRoot;
	const inherited = sameCodingProject
		? extractInheritedState(previous.getBranch())
		: null;
	const hasInheritedState = inherited !== null;
	if (!hasInheritedState) return { state, handoffContext: false };
	const inheritedState = {
		...inherited,
		inheritedFrom: previous.getSessionId(),
	};
	appendState(runtime, inheritedState);
	return { state: inheritedState, handoffContext: true };
}

function activateSession(
	runtime: ExtensionRuntime,
	ctx: ExtensionContext,
	project: NonNullable<ActiveSession["project"]>,
	state: ActiveSession["state"],
	handoffContext: boolean,
	allowPrDiscovery: boolean,
): ActiveSession {
	const session: ActiveSession = {
		sessionId: ctx.sessionManager.getSessionId(),
		context: ctx,
		project,
		state,
		allowPrDiscovery,
		prDiscoveryTestedUrls: new Set<string>(),
		handoffContext,
		workChanged: false,
		hasUncommittedChanges: false,
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
	};
	runtime.active = session;
	return session;
}

function manageActiveTools(runtime: ExtensionRuntime): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) return;
	const hasActiveToolReader =
		typeof runtime.pi.getActiveTools === FUNCTION_TYPE;
	const hasActiveToolWriter =
		typeof runtime.pi.setActiveTools === FUNCTION_TYPE;
	const canManageActiveTools = hasActiveToolReader && hasActiveToolWriter;
	const shouldRegisterStateTool = runtime.registered && canManageActiveTools;
	if (!shouldRegisterStateTool) return;
	const activeTools = runtime.pi.getActiveTools();
	const shouldAddStateTool = !activeTools.includes(C.tool.state);
	if (!shouldAddStateTool) return;
	runtime.pi.setActiveTools([...activeTools, C.tool.state]);
}

async function startFooter(
	runtime: ExtensionRuntime,
	event: SessionStartEvent,
	ctx: ExtensionContext,
	inheritedHandoff: boolean,
): Promise<void> {
	const footerEvent = inheritedHandoff
		? event
		: { ...event, previousSessionFile: undefined };
	await runtime.footer.sessionStart(footerEvent, ctx);
}

async function initializeWorkingTreeStatus(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	cwd: string,
): Promise<void> {
	if (session.state.prUrl === undefined) return;
	const status = await hasUncommittedChanges(
		runtime.dependencies.exec ?? spawnExec,
		cwd,
	);
	const isCurrentSession = runtime.active === session;
	const shouldSkipStatusUpdate = !isCurrentSession || status === null;
	if (shouldSkipStatusUpdate) return;
	session.hasUncommittedChanges = status;
	refreshFooterStatuses(runtime, session);
}

export async function handleSessionStart(
	runtime: ExtensionRuntime,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	resetTemporarySessionState(runtime);
	deactivateUnconfiguredSession(runtime);
	const config = await (runtime.dependencies.loadConfig ?? loadConfig)();
	const project = resolveConfiguredProject(ctx.cwd, config);
	const hasProject = project !== null;
	if (!hasProject) {
		deactivateUnconfiguredSession(runtime);
		return;
	}
	runtime.exitProtocol.sessionStart(ctx);
	void runtime.worktree.sessionStart(ctx);
	const branch = ctx.sessionManager.getBranch();
	const stateEntry = latestStateData(branch, C.entry.state);
	let state = latestState(branch);
	const inherited = inheritPreviousState(
		runtime,
		event,
		config,
		project,
		stateEntry,
		state,
	);
	state = await initializeRemoteOrigin(runtime, ctx, inherited.state);
	const inheritedHandoff = inherited.handoffContext;
	await startFooter(runtime, event, ctx, inheritedHandoff);
	const allowPrDiscovery = inheritedHandoff
		? false
		: stateEntry?.prDiscoveryDisabled !== true && !state.prUrl;
	const session = activateSession(
		runtime,
		ctx,
		project,
		state,
		inherited.handoffContext,
		allowPrDiscovery,
	);
	installStateTool(runtime);
	manageActiveTools(runtime);
	const isTuiMode = ctx.mode === C.value.tui;
	if (isTuiMode) ctx.ui.setFooter(undefined);
	await persistInitialPr(runtime, branch);
	refreshFooterStatuses(runtime, session);
	void initializeWorkingTreeStatus(runtime, session, ctx.cwd);
}

export async function persistInitialPr(
	runtime: ExtensionRuntime,
	branch: readonly unknown[],
): Promise<void> {
	const session = runtime.active;
	const canDiscoverPr = session?.allowPrDiscovery === true;
	if (!canDiscoverPr) return;
	await persistPrIfAvailable(runtime, branchTexts(branch).join("\n"));
}

export function handleSessionShutdown(runtime: ExtensionRuntime): void {
	resetTemporarySessionState(runtime);
	const session = runtime.active;
	if (session !== null) {
		deactivateSession(runtime, session);
		runtime.active = null;
	} else {
		runtime.footer.deactivate();
	}
	runtime.worktree.deactivate();
	runtime.exitProtocol.deactivate();
}
