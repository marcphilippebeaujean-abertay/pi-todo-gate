import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import {
	appendState,
	cancelScheduledSync,
	createClient,
	isCurrentSync,
	refreshFooterStatuses,
	taskPath,
} from "./extension-lifecycle.ts";
import { branchTexts } from "./extension-message.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import {
	readPiTaskStore,
	syncPiTasksToTodoist,
	syncTodoistToPiTasks,
	writePiTaskStore,
} from "./pi-tasks-sync.ts";
import { applyStatePatch } from "./session-state.ts";

const TODOIST_TASK_URL_RE =
	/https:\/\/app\.todoist\.com\/app\/task\/([A-Za-z0-9_-]+)/gi;
const TODOIST_TASK_ID_RE =
	/\b(?:todoist\s+)?task\s+id\s*[:#]?\s*`?([A-Za-z0-9_-]+)/gi;
const CLAIMED_TASK_ID_RE =
	/\b(?:todoist\s+)?task\s+(?:is\s+)?claimed\s*[:#]?\s*`?([A-Za-z0-9_-]+)/gi;
const TODOIST_MOVE_RE =
	/\btd\s+task\s+move\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))(?=[\s\S]*?--section\s+(?:"In Progress"|'In Progress'|In Progress))/gi;
const CLAIMED_TASK_RE =
	/\b(?:claimed|claiming)\s+(?:a\s+)?(?:todoist\s+)?task\b|\b(?:todoist\s+)?task\s+(?:is\s+)?claimed\b|--section\s+(?:"In Progress"|'In Progress'|In Progress)/i;
const NEGATED_CLAIM_RE =
	/\b(?:no|not|never)\s+(?:[a-z]+\s+){0,2}claimed\s+(?:a\s+)?(?:todoist\s+)?task\b/i;

function addMatches(
	text: string,
	expression: RegExp,
	matches: Set<string>,
): void {
	expression.lastIndex = 0;
	for (
		let match = expression.exec(text);
		match;
		match = expression.exec(text)
	) {
		const value = match.slice(1).find((candidate) => candidate);
		const hasValue = value !== undefined;
		if (!hasValue) continue;
		matches.add(value);
	}
}

export function inferClaimedTaskRef(
	entries: readonly unknown[],
	prompt = "",
): string | undefined {
	const texts = [...branchTexts(entries), prompt];
	const allTaskRefs = new Set<string>();
	let hasUnboundClaimEvidence = false;
	for (const text of texts) {
		const textTaskRefs = new Set<string>();
		addMatches(text, TODOIST_TASK_URL_RE, textTaskRefs);
		addMatches(text, TODOIST_TASK_ID_RE, textTaskRefs);
		addMatches(text, CLAIMED_TASK_ID_RE, textTaskRefs);
		addMatches(text, TODOIST_MOVE_RE, textTaskRefs);
		for (const taskRef of textTaskRefs) allTaskRefs.add(taskRef);

		const positiveClaim =
			CLAIMED_TASK_RE.test(text) && !NEGATED_CLAIM_RE.test(text);
		if (!positiveClaim) continue;
		const associatedTaskRef = textTaskRefs.values().next().value;
		const hasAssociatedTaskRef = associatedTaskRef !== undefined;
		if (hasAssociatedTaskRef) return associatedTaskRef;
		hasUnboundClaimEvidence = true;
	}
	return hasUnboundClaimEvidence
		? allTaskRefs.values().next().value
		: undefined;
}

export async function linkInferredTask(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	prompt = "",
): Promise<boolean> {
	const hasExistingTaskRef = session.state.taskRef !== undefined;
	if (hasExistingTaskRef) return false;
	const taskRef = inferClaimedTaskRef(
		session.context.sessionManager.getBranch(),
		prompt,
	);
	const hasTaskRef = taskRef !== undefined;
	if (!hasTaskRef) return false;
	try {
		const client = createClient(session.context, runtime.dependencies);
		const project = await client.resolveProject(
			session.project.todoistProjectRef,
		);
		const claimed = await client.claimTask(taskRef, {
			id: project.id,
			currentTaskId: taskRef,
		});
		await syncTodoistToPiTasks(client, claimed.id, taskPath(session));
		session.syncAvailable = true;
		session.state = applyStatePatch(session.state, {
			taskRef: claimed.id,
			taskName: claimed.content,
			taskUrl:
				claimed.webUrl ??
				claimed.url ??
				`https://app.todoist.com/app/task/${claimed.id}`,
		});
		appendState(runtime, session.state, !session.allowPrDiscovery);
		refreshFooterStatuses(session);
		return true;
	} catch {
		session.context.ui.notify(C.message.taskNotLinked, C.value.warning);
		return false;
	}
}

async function runScheduledSync(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	parentRef: string,
	generation: number,
): Promise<void> {
	session.syncTimer = undefined;
	const isSyncStale = !isCurrentSync(runtime.active, session, generation);
	if (isSyncStale) return;
	try {
		const store = await readPiTaskStore(taskPath(session));
		await syncPiTasksToTodoist(
			createClient(session.context, runtime.dependencies),
			parentRef,
			store ?? { nextId: 1, tasks: [] },
			() => isCurrentSync(runtime.active, session, generation),
		);
	} catch {
		const isSyncCurrent = isCurrentSync(runtime.active, session, generation);
		if (isSyncCurrent)
			session.context.ui.notify(C.message.taskUpdateFailed, C.value.warning);
	}
}

export function scheduleSync(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): void {
	const parentRef = session.state.taskRef;
	const hasParentRef = parentRef !== undefined;
	if (!hasParentRef) return;
	const syncIsAvailable = session.syncAvailable;
	if (!syncIsAvailable) return;
	cancelScheduledSync(session);
	const generation = session.syncGeneration;
	session.syncTimer = setTimeout(
		runScheduledSync.bind(null, runtime, session, parentRef, generation),
		25,
	);
}

export async function clearLocalTasks(session: ActiveSession): Promise<void> {
	await writePiTaskStore(taskPath(session), { nextId: 1, tasks: [] });
}
