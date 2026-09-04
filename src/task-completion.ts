import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type { ExitActionResult } from "./exit-protocol/types.ts";
import {
	appendState,
	createClient,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import { enqueueSessionOperation } from "./session-operations.ts";
import { applyStatePatch } from "./session-state.ts";

function isCurrentCompletion(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	stateSnapshot: ActiveSession["state"],
	workRevision: number,
): boolean {
	const isCurrentSession = runtime.active === session;
	const isCurrentRevision = session.workRevision === workRevision;
	const isCurrentTask = session.state.taskRef === stateSnapshot.taskRef;
	const isCurrentPr = session.state.prUrl === stateSnapshot.prUrl;
	const isCurrentSessionAndRevision = isCurrentSession && isCurrentRevision;
	const isCurrentIdentity = isCurrentTask && isCurrentPr;
	return isCurrentSessionAndRevision && isCurrentIdentity;
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

function recordFailedCompletion(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionContext,
): void {
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			todoistCompletionAttemptedAt: new Date().toISOString(),
		}),
	);
	appendState(runtime, session.state);
	refreshFooterStatuses(runtime, session);
	ctx.ui.notify(C.message.mergedFailed, C.value.warning);
}

async function completeMergedTaskNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionContext,
	taskRef: string,
	stateSnapshot: ActiveSession["state"],
	workRevision: number,
): Promise<ExitActionResult> {
	const isCurrent = isCurrentCompletion.bind(
		null,
		runtime,
		session,
		stateSnapshot,
		workRevision,
	);
	const hasCompletionAttempt =
		session.state.todoistCompletionAttemptedAt !== undefined;
	const isStaleCompletion = !isCurrent();
	const shouldSkipCompletion = isStaleCompletion || hasCompletionAttempt;
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
		recordFailedCompletion(runtime, session, ctx);
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
		),
	);
}
