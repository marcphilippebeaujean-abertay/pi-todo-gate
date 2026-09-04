import {
	type ExtensionContext,
	SessionManager,
	type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveConfiguredProject } from "./config.ts";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import { persistPrIfAvailable } from "./extension-events.ts";
import {
	appendState,
	deactivateSession,
	refreshFooterStatuses,
} from "./extension-lifecycle.ts";
import { branchTexts, latestStateData } from "./extension-message.ts";
import { installStateTool } from "./extension-tool.ts";
import type {
	ActiveSession,
	ExtensionRuntime,
	SessionReader,
} from "./extension-types.ts";
import { firstGithubPrUrl } from "./pr-detection.ts";
import { extractInheritedState, latestState } from "./session-state.ts";
import type { TodoistProjectMapping } from "./types.ts";

const FUNCTION_TYPE = "function";

function deactivateUnconfiguredSession(runtime: ExtensionRuntime): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (hasSession) {
		deactivateSession(session);
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
		context: ctx,
		project,
		state,
		allowPrDiscovery,
		handoffContext,
		workChanged: false,
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
		taskClaimAnalysisStarted: false,
		taskClaimGeneration: 0,
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

export async function handleSessionStart(
	runtime: ExtensionRuntime,
	event: SessionStartEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const config = await (runtime.dependencies.loadConfig ?? loadConfig)();
	const project = resolveConfiguredProject(ctx.cwd, config);
	const hasProject = project !== null;
	if (!hasProject) {
		deactivateUnconfiguredSession(runtime);
		return;
	}
	if (runtime.active !== null) deactivateSession(runtime.active);
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
	state = inherited.state;
	const inheritedHandoff = inherited.handoffContext;
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
	refreshFooterStatuses(session);
	persistInitialPr(runtime, branch);
}

export function persistInitialPr(
	runtime: ExtensionRuntime,
	branch: readonly unknown[],
): void {
	const session = runtime.active;
	const canDiscoverPr = session?.allowPrDiscovery === true;
	if (!canDiscoverPr) return;
	persistPrIfAvailable(runtime, firstGithubPrUrl(branchTexts(branch)) ?? "");
}

export function handleSessionShutdown(runtime: ExtensionRuntime): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) return;
	deactivateSession(session);
	runtime.active = null;
}
