import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	appendState,
	createClient,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import { inspectWorktree, spawnExec } from "./git.ts";
import { applyStatePatch } from "./session-state.ts";
import type { TaskClaimWorkerResult } from "./todoist/claim-worker.ts";
import { createTaskClaimWorker } from "./todoist/claim-worker.ts";

const INFO = "info";
const PROPOSAL_TITLE = "Todoist task proposal";
const RETRY_TITLE = "Todoist task claiming failed";
const RETRY = "Retry task claiming";
const LEAVE_UNASSIGNED = "Leave task unassigned";
const CREATE = "create";
const CLAIM = "claim";
const ERROR = "error";
const EMPTY_DESCRIPTION = "(none)";
const ASSIGNED = "Todoist task assigned";
const NEW_TASK = "new task";
const EXISTING_TASK = "claim existing task";
const TASK_URL = "https://app.todoist.com/app/task/";
const UNKNOWN_ERROR = "Unknown claim error.";
const INVALID_RESULT = "Invalid claim worker result.";

type PromptUI = Pick<ExtensionContext["ui"], "confirm" | "select" | "notify">;
type ActionableProposal = Omit<TaskClaimWorkerResult, "action" | "taskData"> &
	(
		| {
				action: "claim";
				taskData: { title: string; description: string; id: string };
		  }
		| {
				action: "create";
				taskData: { title: string; description: string; id: null };
		  }
	);

type ClaimPromptContext = {
	runtime: ExtensionRuntime;
	session: ActiveSession;
	context: ExtensionContext;
	generation: number;
	prompt: string;
};

function uiOf(context: ExtensionContext): PromptUI {
	return context.ui;
}

function current(context: ClaimPromptContext): boolean {
	return (
		context.generation === context.session.taskClaimGeneration &&
		context.runtime.active === context.session
	);
}

function proposalMessage(result: ActionableProposal): string {
	const isCreateAction = result.action === CREATE;
	const action = isCreateAction ? NEW_TASK : EXISTING_TASK;
	const description = result.taskData.description || EMPTY_DESCRIPTION;
	return [
		`Action: ${action}`,
		`Title: ${result.taskData.title}`,
		`Description: ${description}`,
		"",
		`Confirm this ${action}?`,
	].join("\n");
}

async function handleError(
	context: ClaimPromptContext,
	message: string,
): Promise<void> {
	const ui = uiOf(context.context);
	const choice = await ui.select(`${RETRY_TITLE}: ${message}`, [
		RETRY,
		LEAVE_UNASSIGNED,
	]);
	const shouldLeaveUnassigned = choice !== RETRY;
	const isCurrent = current(context);
	if (!isCurrent) return;
	if (shouldLeaveUnassigned) {
		context.session.taskClaimGeneration += 1;
		return;
	}
	context.session.taskClaimAnalysisStarted = false;
	const generation = ++context.session.taskClaimGeneration;
	void runTaskClaim(
		context.runtime,
		context.session,
		context.prompt,
		generation,
	);
}

async function applyProposal(
	context: ClaimPromptContext,
	result: ActionableProposal,
): Promise<void> {
	const client = createClient(context.context, context.runtime.dependencies);
	const isCurrent = () => current(context);
	const project = await client.resolveProject(
		context.session.project.todoistProjectRef,
		isCurrent,
	);
	const isCreateAction = result.action === CREATE;
	const task = isCreateAction
		? await client.createTask(
				result.taskData.title,
				result.taskData.description,
				{ id: project.id },
				isCurrent,
			)
		: await client.claimTask(result.taskData.id, { id: project.id }, isCurrent);
	const isStale = !current(context);
	if (isStale) return;
	replaceSessionState(
		context.session,
		applyStatePatch(context.session.state, {
			taskRef: task.id,
			taskName: task.content,
			taskUrl: task.webUrl ?? task.url ?? `${TASK_URL}${task.id}`,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	appendState(
		context.runtime,
		context.session.state,
		context.session.allowPrDiscovery === false,
	);
	refreshFooterStatuses(context.session);
	uiOf(context.context).notify(ASSIGNED, INFO);
}

async function handleProposal(
	context: ClaimPromptContext,
	result: ActionableProposal,
): Promise<void> {
	const accepted = await uiOf(context.context).confirm(
		PROPOSAL_TITLE,
		proposalMessage(result),
	);
	const declined = !accepted;
	if (declined) {
		context.session.taskClaimGeneration += 1;
		return;
	}
	const isStale = !current(context);
	if (isStale) return;
	try {
		await applyProposal(context, result);
	} catch (error) {
		const isStale = !current(context);
		if (isStale) return;
		const message = error instanceof Error ? error.message : String(error);
		await handleError(context, message);
	}
}

async function handleResult(
	context: ClaimPromptContext,
	result: TaskClaimWorkerResult,
): Promise<void> {
	const isStale = !current(context);
	if (isStale) return;
	const action = result.action;
	const isErrorAction = action === ERROR;
	if (isErrorAction) {
		await handleError(context, result.error ?? UNKNOWN_ERROR);
		return;
	}
	const hasNoTaskData = result.taskData === null;
	if (hasNoTaskData) {
		await handleError(context, INVALID_RESULT);
		return;
	}
	const hasError = result.error !== null;
	if (hasError) {
		await handleError(context, INVALID_RESULT);
		return;
	}
	const taskData = result.taskData;
	const hasMissingTaskData = taskData === null;
	if (hasMissingTaskData) {
		await handleError(context, INVALID_RESULT);
		return;
	}
	const isClaimAction = action === CLAIM;
	const hasTaskId = taskData.id !== null;
	const hasUnexpectedId = isClaimAction ? !hasTaskId : hasTaskId;
	if (hasUnexpectedId) {
		await handleError(context, INVALID_RESULT);
		return;
	}
	await handleProposal(context, {
		...result,
		taskData,
	} as ActionableProposal);
}

export async function runTaskClaim(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	prompt: string,
	generation: number,
): Promise<void> {
	const context: ClaimPromptContext = {
		runtime,
		session,
		context: session.context,
		generation,
		prompt,
	};
	try {
		const exec = runtime.dependencies.exec ?? spawnExec;
		const worktree = await inspectWorktree(exec, session.context.cwd);
		const worker =
			runtime.dependencies.taskClaimWorker ?? createTaskClaimWorker(exec);
		const result = await worker({
			prompt,
			cwd: session.context.cwd,
			projectRef: session.project.todoistProjectRef,
			worktree,
		});
		await handleResult(context, result);
	} catch (error) {
		const isStale = !current(context);
		if (isStale) return;
		const message = error instanceof Error ? error.message : String(error);
		await handleError(context, message);
	}
}
