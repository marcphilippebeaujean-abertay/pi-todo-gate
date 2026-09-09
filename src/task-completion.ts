import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import {
	appendState,
	createClient,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import { enqueueSessionOperation } from "./session-operations.ts";
import { applyStatePatch } from "./session-state.ts";
import type { ExitActionResult } from "./shared/exit-actions.ts";

function isCurrentCompletion(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	stateSnapshot: ActiveSession["state"],
	workRevision: number,
	operationGeneration: number,
): boolean {
	const isCurrentSession = runtime.active === session;
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
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionContext,
): void {
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			mergeCompletedAt: new Date().toISOString(),
			todoistCompletionAttemptedAt: new Date().toISOString(),
		}),
	);
	appendState(runtime, session.state);
	refreshFooterStatuses(runtime, session);
	ctx.ui.notify(C.message.merged, C.value.info);
}

function recordFailedCompletion(_ctx: ExtensionContext): void {
	_ctx.ui.notify(C.message.mergedFailed, C.value.warning);
}

async function completeMergedTaskNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionContext,
	taskRef: string,
	stateSnapshot: ActiveSession["state"],
	workRevision: number,
	operationGeneration: number,
): Promise<ExitActionResult> {
	const isCurrent = isCurrentCompletion.bind(
		null,
		runtime,
		session,
		stateSnapshot,
		workRevision,
		operationGeneration,
	);
	const isStaleCompletion = !isCurrent();
	const shouldSkipCompletion = isStaleCompletion;
	if (shouldSkipCompletion) return C.exit.failed;
	try {
		await createClient(ctx, runtime.dependencies).completeTask(
			taskRef,
			isCurrent,
		);
		const isStaleSuccess = !isCurrent();
		if (isStaleSuccess) return C.exit.failed;
		recordSuccessfulCompletion(runtime, session, ctx);
		return C.exit.completed;
	} catch {
		const isStaleFailure = !isCurrent();
		if (isStaleFailure) return C.exit.failed;
		recordFailedCompletion(ctx);
		return C.exit.failed;
	}
}

export async function completeMergedTask(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionContext,
	taskRef: string,
	stateSnapshot: ActiveSession["state"],
	workRevision: number,
	operationGeneration: number,
): Promise<ExitActionResult> {
	return enqueueSessionOperation(
		session,
		completeMergedTaskNow.bind(
			null,
			runtime,
			session,
			ctx,
			taskRef,
			stateSnapshot,
			workRevision,
			operationGeneration,
		),
	);
}
