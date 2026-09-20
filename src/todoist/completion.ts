import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";
import { createClient } from "./client.ts";
import {
	notifyCompletionFailure,
	notifyCompletionSuccess,
} from "./event-publishers.ts";
import type {
	TodoistClientFactoryDependencies,
	TodoistCompletionSnapshot,
	TodoistModuleState,
} from "./internal-state.ts";

async function recordSuccessfulCompletion(
	sessionState: SessionState,
	eventHandler: EventHandler,
	ctx: ExtensionContext,
): Promise<void> {
	const todoistState: TodoistModuleState = {
		...sessionState.moduleState.todoist,
		taskRef: undefined,
		taskName: undefined,
		taskDescription: undefined,
		taskUrl: undefined,
		todoistCompletionAttemptedAt: new Date().toISOString(),
	};
	const publisher = createModuleStatePublisher(eventHandler, "todoist");
	await publisher.publish(todoistState, {
		persist: true,
		gitStatePatch: { mergeCompletedAt: new Date().toISOString() },
	});
	notifyCompletionSuccess(ctx);
}

export async function completeMergedTask(
	sessionState: SessionState,
	eventHandler: EventHandler,
	ctx: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
	exec?: Exec,
	createTodoistClient?: TodoistClientFactoryDependencies["createTodoistClient"],
): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
	const client = createClient(ctx, { exec, createTodoistClient });
	try {
		await client.completeTask(snapshot.taskRef);
	} catch {
		notifyCompletionFailure(ctx);
		return "failed";
	}
	await recordSuccessfulCompletion(sessionState, eventHandler, ctx);
	return "completed";
}
