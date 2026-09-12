import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	appendState,
	publishModuleState,
	replaceSessionState,
} from "./application/lifecycle.ts";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import {
	createFooterModule,
	refreshFooterStatuses,
	renderPrStatus,
	renderTaskStatusCompact,
} from "./footer/module.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { createRootPrModule } from "./pr-root.ts";
import { PromptQueue } from "./prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import { createEventHandler } from "./shared/events.ts";
import { isSubagent } from "./shared/session.ts";
import {
	enqueueSessionOperation,
	isCurrentOperation,
} from "./shared/session-operations.ts";
import {
	createSessionState,
	type ExtensionDependencies,
	type ExtensionState,
} from "./state.ts";
import { completeMergedTask } from "./todoist/completion.ts";
import { createTodoistModule } from "./todoist/module.ts";
import { createWorktreeModule } from "./worktree/module.ts";

export type { ExtensionDependencies, WorkStateAction } from "./state.ts";

function attachApplicationOperations(extensionState: ExtensionState): void {
	extensionState.appendState = (state, prDiscoveryDisabled) =>
		appendState(extensionState, state, prDiscoveryDisabled);
	extensionState.refreshFooterStatuses = (session) =>
		refreshFooterStatuses(extensionState.footer, session);
	extensionState.replaceSessionState = (session, nextState) => {
		replaceSessionState(session, nextState);
		publishModuleState(extensionState, C.module.work, { ...nextState });
	};
	extensionState.completeMergedTask = (
		session,
		taskRef,
		stateSnapshot,
		workRevision,
		generation,
	) =>
		completeMergedTask(
			extensionState,
			session,
			session.context,
			taskRef,
			stateSnapshot,
			workRevision,
			generation,
		);
	extensionState.isCurrentOperation = isCurrentOperation;
	extensionState.enqueueSessionOperation = enqueueSessionOperation;
}

function createWorktreeAndExitModules(
	promptQueue: PromptQueue,
	eventHandler: ReturnType<typeof createEventHandler>,
	sessionState: ReturnType<typeof createSessionState>,
	dependencies: ExtensionDependencies,
): Pick<ExtensionState, "worktree" | "exitProtocol"> {
	const worktree = createWorktreeModule({
		eventHandler,
		sessionState,
		dependencies: {
			exec: dependencies.exec,
			formatPrStatus: renderPrStatus,
			formatTaskStatus: renderTaskStatusCompact,
		},
	});
	return {
		worktree,
		exitProtocol: createExitProtocolModule({
			promptQueue,
			eventHandler,
			worktree,
		}),
	};
}

function createScopedModules(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
	eventHandler: ReturnType<typeof createEventHandler>,
	promptQueue: PromptQueue,
	sessionState: ReturnType<typeof createSessionState>,
	stateRef: { current: ExtensionState | null },
): Pick<
	ExtensionState,
	"footer" | "pr" | "todoist" | "worktree" | "exitProtocol"
> {
	const worktreeAndExit = createWorktreeAndExitModules(
		promptQueue,
		eventHandler,
		sessionState,
		dependencies,
	);
	return {
		footer: createFooterModule({
			eventHandler,
			pi,
			dependencies: { openSession: dependencies.openSession },
		}),
		pr: createRootPrModule(
			promptQueue,
			eventHandler,
			sessionState,
			dependencies.exec,
			stateRef,
		),
		todoist: createTodoistModule({
			promptQueue,
			eventHandler,
			sessionState,
			stateRef,
			dependencies: {
				exec: dependencies.exec,
				taskClaimWorker: dependencies.taskClaimWorker,
				createTodoistClient: dependencies.createTodoistClient,
			},
		}),
		...worktreeAndExit,
	};
}

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionState {
	const eventHandler = createEventHandler(),
		promptQueue = new PromptQueue();
	const sessionState = createSessionState(),
		extensionRef: { current: ExtensionState | null } = { current: null };
	const modules = createScopedModules(
		pi,
		dependencies,
		eventHandler,
		promptQueue,
		sessionState,
		extensionRef,
	);
	const extensionState = {
		pi,
		dependencies,
		sessionState,
		promptQueue,
		eventHandler,
		...modules,
		registered: false,
	} as ExtensionState;
	attachApplicationOperations(extensionState);
	extensionRef.current = extensionState;
	return extensionState;
}

function startExtensions(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): void {
	const extensionState = createExtensionState(pi, dependencies);
	registerModuleStateConsumer(
		extensionState.eventHandler,
		extensionState.sessionState,
	);
	registerExtensionEventConsumers(pi, extensionState);
	extensionState.pr.register(pi);
	extensionState.todoist.register();
	installHerdrTabClaim(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
		onFooterUpdate: extensionState.footer.update.bind(extensionState.footer),
	});
}

export default function extension(
	pi: ExtensionAPI,
	dependencies?: ExtensionDependencies,
): void {
	const shouldSkipSubagent = isSubagent();
	if (shouldSkipSubagent) return;
	startExtensions(pi, dependencies ?? {});
}
