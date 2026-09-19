import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { publishSessionNotification } from "../event-publishers.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { runSessionAction } from "../shared/session-actions.ts";
import { enqueueSessionOperation } from "../shared/session-operations.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import { createClient } from "./client.ts";
import {
	COMPLETION_FINISHED_SESSION_CHANGE,
	COMPLETION_SKIPPED_SESSION_CHANGE,
	COMPLETION_UNKNOWN_AFTER_SESSION_CHANGE,
	WARNING,
} from "./constants.ts";
import {
	notifyCompletionFailure,
	notifyCompletionSuccess,
} from "./event-publishers.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistOperations,
	TodoistState,
} from "./internal-state.ts";

function isCurrentCompletionState(
	operations: TodoistOperations,
	session: SessionRecord,
	stateSnapshot: TodoistCompletionSnapshot,
	workRevision: number,
): boolean {
	const isCurrentRevision = session.workRevision === workRevision;
	const isCurrentTask =
		operations.sessionState.moduleState.todoist.taskRef ===
		stateSnapshot.taskRef;
	const isCurrentPr =
		operations.sessionState.moduleState.pr.prUrl === stateSnapshot.prUrl;
	return [isCurrentRevision, isCurrentTask, isCurrentPr].every(Boolean);
}

function isCurrentSession(
	operations: TodoistOperations,
	session: SessionRecord,
	sessionId: string,
): boolean {
	const isCurrentSession = operations.getSession() === session;
	const isCurrentSessionId =
		operations.sessionState.session.activeSessionId === sessionId;
	return isCurrentSession && isCurrentSessionId;
}

function recordSuccessfulCompletion(
	operations: TodoistOperations,
	ctx: ExtensionContext,
): Promise<void> {
	const todoistState: TodoistState = {
		...operations.sessionState.moduleState.todoist,
		taskRef: undefined,
		taskName: undefined,
		taskDescription: undefined,
		taskUrl: undefined,
		todoistCompletionAttemptedAt: new Date().toISOString(),
	};
	const mergeCompletedAt = new Date().toISOString();
	return operations
		.updateTodoistState(todoistState, {
			persist: true,
			gitStatePatch: { mergeCompletedAt },
		})
		.then(() => notifyCompletionSuccess(ctx));
}

function recordFailedCompletion(ctx: ExtensionContext): void {
	notifyCompletionFailure(ctx);
}

async function applyCompletionAction(
	operations: TodoistOperations,
	ctx: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
	isCurrentState: () => boolean,
	isCurrentSessionAction: () => boolean,
): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
	const client = createClient(ctx, {
		exec: operations.exec ?? operations.dependencies?.exec,
		createTodoistClient:
			operations.createTodoistClient ??
			operations.dependencies?.createTodoistClient,
	});
	const action = await runSessionAction(
		isCurrentSessionAction,
		client.completeTask.bind(client, snapshot.taskRef),
		publishSessionNotification.bind(
			null,
			operations.eventHandler,
			COMPLETION_SKIPPED_SESSION_CHANGE,
			WARNING,
		),
	);
	const wasSkipped = !action.started;
	if (wasSkipped) return C.exit.failed;
	const sessionChanged = !action.currentAfterAction;
	if (sessionChanged) {
		await publishSessionNotification(
			operations.eventHandler,
			COMPLETION_FINISHED_SESSION_CHANGE,
			WARNING,
		);
		return C.exit.completed;
	}
	const isCurrentAfterAction = isCurrentSessionAction() && isCurrentState();
	const shouldRecordCompletion = isCurrentAfterAction;
	if (!shouldRecordCompletion) return C.exit.failed;
	await recordSuccessfulCompletion(operations, ctx);
	return C.exit.completed;
}

async function completeMergedTaskNow(
	operations: TodoistOperations,
	session: SessionRecord,
	ctx: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
	const isCurrentState = isCurrentCompletionState.bind(
		null,
		operations,
		session,
		snapshot,
		snapshot.workRevision,
	);
	const isCurrentBeforeAction = isCurrentState();
	if (!isCurrentBeforeAction) return C.exit.failed;
	const isCurrentSessionAction = isCurrentSession.bind(
		null,
		operations,
		session,
		snapshot.sessionId,
	);
	try {
		return await applyCompletionAction(
			operations,
			ctx,
			snapshot,
			isCurrentState,
			isCurrentSessionAction,
		);
	} catch {
		const sessionChangedAfterFailure = !isCurrentSessionAction();
		if (sessionChangedAfterFailure) {
			await publishSessionNotification(
				operations.eventHandler,
				COMPLETION_UNKNOWN_AFTER_SESSION_CHANGE,
				WARNING,
			);
			return C.exit.failed;
		}
		const stateIsCurrentAfterFailure = isCurrentState();
		if (!stateIsCurrentAfterFailure) return C.exit.failed;
		recordFailedCompletion(ctx);
		return C.exit.failed;
	}
}

export async function completeMergedTask(
	operations: TodoistOperations,
	session: SessionRecord,
	ctx: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
	const snapshotCopy: TodoistCompletionSnapshot = {
		taskRef: snapshot.taskRef,
		taskName: snapshot.taskName,
		prUrl: snapshot.prUrl,
		workRevision: snapshot.workRevision,
		sessionId: snapshot.sessionId,
	};
	return enqueueSessionOperation(
		session,
		completeMergedTaskNow.bind(null, operations, session, ctx, snapshotCopy),
	);
}
