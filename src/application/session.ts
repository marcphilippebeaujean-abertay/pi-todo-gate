import {
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { refreshFooterStatuses } from "../footer/module.ts";
import type { PrSession } from "../pr/state.ts";
import { installStateTool } from "../pr/state-tool.ts";
import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { SessionStartEvent } from "../shared/events.ts";
import { latestStateData } from "../shared/extension-message.ts";
import { hasUncommittedChanges } from "../shared/project.ts";
import type {
	ExtensionState,
	SessionContext,
	SessionReader,
} from "../state.ts";
import {
	currentSessionContext,
	extractInheritedState,
	latestState,
} from "../state.ts";
import { loadConfig, resolveConfiguredProject } from "../todoist/config.ts";
import type { TodoistProjectMapping } from "../todoist/module.ts";
import {
	appendState,
	deactivateSession,
	publishModuleState,
	resetSessionState,
	resetTemporarySessionState,
} from "./lifecycle.ts";

const FUNCTION_TYPE = "function";

function deactivateUnconfiguredSession(runtime: ExtensionState): void {
	const session = currentSessionContext(runtime.sessionState);
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
	resetSessionState(runtime.sessionState);
	currentSessionContext(runtime.sessionState, null);
}

function inheritPreviousState(
	runtime: ExtensionState,
	event: SessionStartEvent,
	config: TodoistProjectMapping,
	project: NonNullable<SessionContext["project"]>,
	stateEntry: Record<string, unknown> | null,
	state: SessionContext["state"],
): { state: SessionContext["state"]; handoffContext: boolean } {
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
	runtime: ExtensionState,
	ctx: ExtensionContext,
	project: NonNullable<SessionContext["project"]>,
	state: SessionContext["state"],
	handoffContext: boolean,
	allowPrDiscovery: boolean,
): SessionContext {
	const session: SessionContext = {
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
	runtime.sessionState.sessionId = session.sessionId;
	publishModuleState(runtime, C.module.work, { ...state });
	currentSessionContext(runtime.sessionState, session);
	runtime.pr.activateSession(session);
	return session;
}

function manageActiveTools(runtime: ExtensionState): void {
	const session = currentSessionContext(runtime.sessionState);
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

async function initializeWorkingTreeStatus(
	runtime: ExtensionState,
	session: SessionContext,
	cwd: string,
): Promise<void> {
	if (session.state.prUrl === undefined) return;
	const status = await hasUncommittedChanges(
		runtime.dependencies.exec ?? spawnExec,
		cwd,
	);
	const isCurrentSession =
		currentSessionContext(runtime.sessionState) === session;
	const shouldSkipStatusUpdate = !isCurrentSession || status === null;
	if (shouldSkipStatusUpdate) return;
	session.hasUncommittedChanges = status;
	refreshFooterStatuses(runtime.footer, session);
}

async function activateConfiguredSession(
	runtime: ExtensionState,
	event: SessionStartEvent,
	ctx: ExtensionContext,
	project: NonNullable<SessionContext["project"]>,
	config: TodoistProjectMapping,
): Promise<{ session: SessionContext; branch: readonly unknown[] }> {
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
	state = await runtime.pr.initializeRemoteOrigin(ctx, inherited.state);
	const isHandoff = inherited.handoffContext;
	const footerEvent = isHandoff
		? event
		: { ...event, previousSessionFile: undefined };
	await runtime.footer.sessionStart(footerEvent, ctx);
	const allowPrDiscovery = runtime.pr.isDiscoveryAllowed(
		stateEntry,
		state,
		isHandoff,
	);
	const session = activateSession(
		runtime,
		ctx,
		project,
		state,
		inherited.handoffContext,
		allowPrDiscovery,
	);
	return { session, branch };
}

export async function handleSessionStart(
	runtime: ExtensionState,
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
	const { session, branch } = await activateConfiguredSession(
		runtime,
		event,
		ctx,
		project,
		config,
	);
	installStateTool(
		runtime,
		currentSessionContext.bind(
			null,
			runtime.sessionState,
		) as unknown as () => PrSession | null,
	);
	manageActiveTools(runtime);
	const isTuiMode = ctx.mode === C.value.tui;
	if (isTuiMode) ctx.ui.setFooter(undefined);
	await persistInitialPr(runtime, branch);
	refreshFooterStatuses(runtime.footer, session);
	void initializeWorkingTreeStatus(runtime, session, ctx.cwd);
}

export async function persistInitialPr(
	runtime: ExtensionState,
	branch: readonly unknown[],
): Promise<void> {
	const session = currentSessionContext(runtime.sessionState);
	const canDiscoverPr = session?.allowPrDiscovery === true;
	if (!canDiscoverPr) return;
	await runtime.pr.persistInitialPr(branch);
}

export function handleSessionShutdown(runtime: ExtensionState): void {
	resetTemporarySessionState(runtime);
	const session = currentSessionContext(runtime.sessionState);
	if (session !== null) {
		deactivateSession(runtime, session);
		currentSessionContext(runtime.sessionState, null);
	} else {
		runtime.footer.deactivate();
	}
	runtime.worktree.deactivate();
	runtime.exitProtocol.deactivate();
	resetSessionState(runtime.sessionState);
	currentSessionContext(runtime.sessionState, null);
}
