import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendState, replaceSessionState } from "./application/lifecycle.ts";
import {
	registerExtensionEventConsumers,
	registerModuleStateConsumer,
} from "./event-consumer.ts";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import { createFooterModule, refreshFooterStatuses } from "./footer/module.ts";
import { installHerdrTabClaim } from "./herdr/module.ts";
import { register } from "./pr/module.ts";
import { createSharedEvents } from "./shared/events.ts";
import { PromptQueue } from "./shared/prompt-queue.ts";
import { isSubagent } from "./shared/session.ts";
import {
	enqueueSessionOperation,
	isCurrentOperation,
} from "./shared/session-operations.ts";
import type { ExtensionDependencies, ExtensionRuntime } from "./state.ts";
import { createExtensionState } from "./state.ts";
import { completeMergedTask } from "./todoist/completion.ts";
import { registerTodoistMergeConsumer } from "./todoist/module.ts";
import { createWorktreeModule } from "./worktree/module.ts";

export type { ExtensionDependencies, WorkStateAction } from "./state.ts";

export function createExtensionRuntime(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionRuntime {
	const events = createSharedEvents();
	const promptQueue = new PromptQueue();
	const runtime: ExtensionRuntime = {
		pi,
		dependencies,
		state: createExtensionState(),
		events,
		exitProtocol: createExitProtocolModule(events, promptQueue),
		footer: createFooterModule(pi, {
			openSession: dependencies.openSession,
		}),
		worktree: createWorktreeModule(events, { exec: dependencies.exec }),
		taskClaim: { pending: false, completed: false },
		promptQueue,
		active: null,
		appendState: (state, prDiscoveryDisabled) =>
			appendState(runtime, state, prDiscoveryDisabled),
		refreshFooterStatuses: (session) => refreshFooterStatuses(runtime, session),
		replaceSessionState,
		completeMergedTask: (
			session,
			taskRef,
			stateSnapshot,
			workRevision,
			generation,
		) =>
			completeMergedTask(
				runtime,
				session,
				session.context,
				taskRef,
				stateSnapshot,
				workRevision,
				generation,
			),
		isCurrentOperation,
		enqueueSessionOperation,
		registered: false,
	};
	registerTodoistMergeConsumer(runtime);
	return runtime;
}

function startExtensions(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): void {
	const runtime = createExtensionRuntime(pi, dependencies);
	registerModuleStateConsumer(runtime.events, runtime.state);
	registerExtensionEventConsumers(pi, runtime);
	register(pi, runtime);
	installHerdrTabClaim(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
		onFooterUpdate: runtime.footer.update.bind(runtime.footer),
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
