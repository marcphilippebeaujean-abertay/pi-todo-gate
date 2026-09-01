import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExtensionRuntime } from "../extension-types.ts";
import { completeMergedTask } from "../task-completion.ts";
import type { ExitAction } from "./types.ts";

function createTodoistAction(
	runtime: ExtensionRuntime,
	session: NonNullable<ExtensionRuntime["active"]>,
	stateSnapshot: NonNullable<ExtensionRuntime["active"]>["state"],
	taskRef: string,
): ExitAction {
	const taskName = stateSnapshot.taskName ?? taskRef;
	const workRevision = session.workRevision;
	return {
		id: C.todoist.exitActionId,
		label: `${C.todoist.completeLabelPrefix}${taskName}${C.todoist.completeLabelSuffix}`,
		execute: () =>
			completeMergedTask(
				runtime,
				session,
				session.context,
				taskRef,
				stateSnapshot,
				workRevision,
			),
	};
}

export function registerTodoistExitAction(runtime: ExtensionRuntime): void {
	runtime.events.on(C.event.prMerged, (request) => {
		const session = runtime.active;
		const hasTask = Boolean(session?.state.taskRef);
		const canCollect = hasTask && session !== null;
		if (!canCollect) return;
		const stateSnapshot = structuredClone(session.state);
		const taskRef = stateSnapshot.taskRef;
		const hasSnapshotTask = taskRef !== undefined;
		if (!hasSnapshotTask) return;
		request.addAction(
			createTodoistAction(runtime, session, stateSnapshot, taskRef),
		);
	});
}
