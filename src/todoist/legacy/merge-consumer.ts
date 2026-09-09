import { EXTENSION_CONSTANTS as C } from "../../constants.ts";
import type { ExtensionRuntime } from "../../extension-types.ts";
import type { EventRequest, SharedEventPayloads } from "../../shared/events.ts";
import { completeMergedTask } from "../../task-completion.ts";

function taskPrompt(taskName: string): string {
	return `${C.todoist.completeLabelPrefix}${taskName}${C.todoist.completeLabelSuffix}?`;
}

type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;

async function consumeMergedEvent(
	runtime: ExtensionRuntime,
	request: MergeRequest,
): Promise<void> {
	const alreadyCompleted = request.payload.taskMarkedAsCompleted === true;
	if (alreadyCompleted) return;
	const session = runtime.active;
	if (session === null) return;
	const hasInteractiveUi = session.context.hasUI;
	if (!hasInteractiveUi) return;
	const taskRef = session.state.taskRef;
	if (taskRef === undefined) return;
	const taskName = session.state.taskName ?? taskRef;
	const stateSnapshot = structuredClone(session.state);
	const workRevision = session.workRevision;
	const operationGeneration = session.operationGeneration;
	const confirmed = await session.context.ui.confirm(
		taskPrompt(taskName),
		`Todoist task ${taskRef}`,
	);
	if (!confirmed) return;
	const result = await completeMergedTask(
		runtime,
		session,
		session.context,
		taskRef,
		stateSnapshot,
		workRevision,
		operationGeneration,
	);
	const completed = result === C.exit.completed;
	if (!completed) return;
	request.payload.taskMarkedAsCompleted = true;
}

export function registerTodoistMergeConsumer(runtime: ExtensionRuntime): void {
	runtime.events.on(
		C.event.prMerged,
		consumeMergedEvent.bind(null, runtime),
		C.value.collect,
	);
}
