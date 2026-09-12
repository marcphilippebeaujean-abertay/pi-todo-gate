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
import { createFooterModule, refreshFooterStatuses } from "./footer/module.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { createPrModule } from "./pr/module.ts";
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

export function createExtensionState(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionState {
	const eventHandler = createEventHandler();
	const promptQueue = new PromptQueue();
	const sessionState = createSessionState();
	const stateRef: { current: ExtensionState | null } = { current: null };
	const moduleContext = { promptQueue, eventHandler, sessionState };
	const extensionState = {
		pi,
		dependencies,
		sessionState,
		promptQueue,
		eventHandler,
		footer: createFooterModule(
			pi,
			{ openSession: dependencies.openSession },
			moduleContext,
		),
		pr: createPrModule(eventHandler, sessionState, stateRef),
		todoist: createTodoistModule(eventHandler, sessionState, stateRef),
		worktree: createWorktreeModule(
			eventHandler,
			{ exec: dependencies.exec },
			moduleContext,
		),
		exitProtocol: createExitProtocolModule(
			eventHandler,
			promptQueue,
			moduleContext,
		),
		registered: false,
	} as ExtensionState;
	attachApplicationOperations(extensionState);
	stateRef.current = extensionState;
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
