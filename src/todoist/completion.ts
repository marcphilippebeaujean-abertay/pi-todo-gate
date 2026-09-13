import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import { enqueueSessionOperation } from "../shared/session-operations.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import { applyStatePatch } from "../shared/session-state.ts";
import { createClient } from "./client.ts";
import {
	notifyCompletionFailure,
	notifyCompletionSuccess,
} from "./event-publishers.ts";
import type { TodoistOperations } from "./state.ts";

function isCurrentCompletion(
	operations: TodoistOperations,
	session: SessionRecord,
	stateSnapshot: SessionRecord["state"],
	workRevision: number,
	operationGeneration: number,
): boolean {
	const isCurrentSession = operations.getSession() === session;
	const isCurrentGeneration =
		session.operationGeneration === operationGeneration;
	const isCurrentRevision = session.workRevision === workRevision;
	const isCurrentTask = session.state.taskRef === stateSnapshot.taskRef;
	const isCurrentPr = session.state.prUrl === stateSnapshot.prUrl;
	const isCurrentSessionAndRevision = isCurrentSession && isCurrentRevision;
	const isCurrentSessionRevisionAndGeneration =
		isCurrentSessionAndRevision && isCurrentGeneration;
	const isCurrentIdentity = isCurrentTask && isCurrentPr;
	return isCurrentSessionRevisionAndGeneration && isCurrentIdentity;
}

function recordSuccessfulCompletion(
	operations: TodoistOperations,
	session: SessionRecord,
	ctx: ExtensionContext,
): void {
	operations.replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: undefined,
			taskName: undefined,
			taskUrl: undefined,
			mergeCompletedAt: new Date().toISOString(),
			todoistCompletionAttemptedAt: new Date().toISOString(),
		}),
	);
	operations.appendState(session.state);
	operations.refreshFooterStatuses(session);
	void operations.emitState(session);
	notifyCompletionSuccess(ctx);
}

function recordFailedCompletion(ctx: ExtensionContext): void {
	notifyCompletionFailure(ctx);
}

async function completeMergedTaskNow(
	operations: TodoistOperations,
	session: SessionRecord,
	ctx: ExtensionContext,
	taskRef: string,
	stateSnapshot: SessionRecord["state"],
	workRevision: number,
	operationGeneration: number,
): Promise<ExitActionResult> {
	const isCurrent = isCurrentCompletion.bind(
		null,
		operations,
		session,
		stateSnapshot,
		workRevision,
		operationGeneration,
	);
	const isStaleCompletion = !isCurrent();
	const shouldSkipCompletion = isStaleCompletion;
	if (shouldSkipCompletion) return C.exit.failed;
	try {
		await createClient(ctx, operations.dependencies).completeTask(
			taskRef,
			isCurrent,
		);
		const isStaleSuccess = !isCurrent();
		if (isStaleSuccess) return C.exit.failed;
		recordSuccessfulCompletion(operations, session, ctx);
		return C.exit.completed;
	} catch {
		const isStaleFailure = !isCurrent();
		if (isStaleFailure) return C.exit.failed;
		recordFailedCompletion(ctx);
		return C.exit.failed;
	}
}

export async function completeMergedTask(
	operations: TodoistOperations,
	session: SessionRecord,
	ctx: ExtensionContext,
	taskRef: string,
	stateSnapshot: SessionRecord["state"],
	workRevision: number,
	operationGeneration: number,
): Promise<ExitActionResult> {
	return enqueueSessionOperation(
		session,
		completeMergedTaskNow.bind(
			null,
			operations,
			session,
			ctx,
			taskRef,
			stateSnapshot,
			workRevision,
			operationGeneration,
		),
	);
}
