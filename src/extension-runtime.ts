import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExitProtocolModule } from "./exit-protocol/module.ts";
import {
	appendState,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import type {
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";
import { createFooterModule } from "./footer/module.ts";
import {
	enqueueSessionOperation,
	isCurrentOperation,
} from "./session-operations.ts";
import { createSharedEvents } from "./shared/events.ts";
import { completeMergedTask } from "./task-completion.ts";
import { registerTodoistMergeConsumer } from "./todoist/module.ts";
import { createWorktreeModule } from "./worktree/module.ts";

export function createExtensionRuntime(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionRuntime {
	const events = createSharedEvents();
	const runtime: ExtensionRuntime = {
		pi,
		dependencies,
		events,
		exitProtocol: createExitProtocolModule(events),
		footer: createFooterModule(pi, {
			openSession: dependencies.openSession,
		}),
		worktree: createWorktreeModule(events, { exec: dependencies.exec }),
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
