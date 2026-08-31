import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, resolveConfiguredProject } from "../src/config.ts";
import { EXTENSION_CONSTANTS as C } from "../src/constants.ts";
import { renderPrStatus, renderTaskStatus } from "../src/footer.ts";
import {
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	spawnExec,
} from "../src/git.ts";
import {
	type CommandRunner as HerdrCommandRunner,
	installHerdrClaimGate,
	type StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";
import { startClaimWorker } from "../src/herdr-claim-worker.ts";
import {
	readPiTaskStore,
	sessionTaskPath,
	syncPiTasksToTodoist,
	syncTodoistToPiTasks,
	writePiTaskStore,
} from "../src/pi-tasks-sync.ts";
import { firstGithubPrUrl, githubPrUrl } from "../src/pr-detection.ts";
import {
	applyStatePatch,
	extractInheritedState,
	latestState,
} from "../src/session-state.ts";
import { TodoistClient } from "../src/todoist.ts";
import type {
	ResolvedProject,
	TodoistProjectMapping,
	WorkState,
} from "../src/types.ts";

export type WorkStateAction =
	| { action: "status" }
	| { action: "set_pr"; url: string }
	| { action: "clear_pr" }
	| { action: "set_task"; task: string }
	| { action: "clear_task" }
	| { action: "clear_all" };

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
}

const STATE_TYPE = "pi-todo-gate-state";
const MISSING_TASK_WARNING = "you have no claimed a todoist task yet!";
const taskToolNames = new Set([
	"TaskCreate",
	"TaskUpdate",
	"TaskStop",
	"TaskExecute",
]);
const stateParameters = Type.Object({
	action: StringEnum([
		"status",
		"set_pr",
		"clear_pr",
		"set_task",
		"clear_task",
		"clear_all",
	] as const),
	url: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
});
type SessionReader = {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
};

interface ActiveSession {
	context: ExtensionContext;
	project: ResolvedProject;
	state: WorkState;
	allowPrDiscovery: boolean;
	handoffContext: boolean;
	workChanged: boolean;
	syncAvailable: boolean;
	syncGeneration: number;
	syncTimer?: ReturnType<typeof setTimeout>;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part: unknown) => {
				if (typeof part !== "object" || part === null) return "";
				if (!(C.content.text in part)) return "";
				return String(part.text);
			})
			.join(" ");
	if (typeof value !== "object" || value === null) return "";
	if (!(C.content.content in value)) return "";
	return textOf((value as { content?: unknown }).content);
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return {
		content: [{ type: C.content.text, text }],
		details: undefined,
	};
}

function latestStateData(
	entries: readonly unknown[],
): Record<string, unknown> | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (typeof entry !== "object" || entry === null) continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: unknown;
		};
		if (candidate.type !== C.entry.custom) continue;
		if (candidate.customType !== STATE_TYPE) continue;
		if (typeof candidate.data !== "object" || candidate.data === null) continue;
		return candidate.data as Record<string, unknown>;
	}
	return null;
}

function branchTexts(entries: readonly unknown[]): string[] {
	return entries
		.filter((entry) => {
			if (typeof entry !== "object" || entry === null) return false;
			return (entry as { type?: unknown }).type !== C.entry.custom;
		})
		.map((entry) => JSON.stringify(entry));
}

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
		if (value === undefined) continue;
		matches.add(value);
	}
}

function inferClaimedTaskRef(
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

		const isPositiveClaim =
			CLAIMED_TASK_RE.test(text) && !NEGATED_CLAIM_RE.test(text);
		if (!isPositiveClaim) continue;
		const associatedTaskRef = textTaskRefs.values().next().value;
		const hasAssociatedTaskRef: boolean = associatedTaskRef !== undefined;
		if (hasAssociatedTaskRef) return associatedTaskRef;
		hasUnboundClaimEvidence = true;
	}
	return hasUnboundClaimEvidence
		? allTaskRefs.values().next().value
		: undefined;
}

function createClient(
	ctx: ExtensionContext,
	dependencies: ExtensionDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) => exec(C.command.todoist, [...args], { cwd: ctx.cwd }),
		})
	);
}

function appendState(
	pi: ExtensionAPI,
	state: WorkState,
	prDiscoveryDisabled = false,
): void {
	const data = prDiscoveryDisabled
		? { ...state, prDiscoveryDisabled: true }
		: state;
	pi.appendEntry(STATE_TYPE, data);
}

function taskPath(active: ActiveSession): string {
	return sessionTaskPath(
		active.context.cwd,
		active.context.sessionManager.getSessionId(),
	);
}

function isCurrentSync(
	active: ActiveSession | null,
	session: ActiveSession,
	generation: number,
): boolean {
	if (active !== session) return false;
	const isCurrentGeneration = generation === session.syncGeneration;
	if (!isCurrentGeneration) return false;
	return session.syncAvailable;
}

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	installHerdrClaimGate(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker:
			dependencies.herdrStartBackgroundWorker ??
			((request) => startClaimWorker(request, { cwd: process.cwd() })),
	});
	let active: ActiveSession | null = null;
	let registered = false;

	const persistPrIfAvailable = (text: string): void => {
		const shouldSkipPrPersistence: boolean = !!(
			!active?.allowPrDiscovery || active.state.prUrl
		);
		if (shouldSkipPrPersistence) return;
		if (!active) return;
		const url = githubPrUrl(text);
		if (url === null) return;
		active.state = applyStatePatch(active.state, { prUrl: url });
		active.allowPrDiscovery = false;
		appendState(pi, active.state);
		refreshFooterStatuses(active);
	};

	const clearLocalTasks = async (session: ActiveSession): Promise<void> => {
		await writePiTaskStore(taskPath(session), { nextId: 1, tasks: [] });
	};

	const cancelScheduledSync = (session: ActiveSession): void => {
		session.syncGeneration += 1;
		if (session.syncTimer) {
			clearTimeout(session.syncTimer);
			session.syncTimer = undefined;
		}
	};

	const refreshFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus(
			C.status.pr,
			renderPrStatus(session.state.prUrl, session.context.ui.theme),
		);
		session.context.ui.setStatus(
			C.status.task,
			renderTaskStatus(
				session.state.taskUrl,
				session.context.ui.theme,
				session.state.taskName,
			),
		);
	};

	const clearFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus(C.status.pr, undefined);
		session.context.ui.setStatus(C.status.task, undefined);
	};

	const deactivate = (session: ActiveSession): void => {
		cancelScheduledSync(session);
		clearFooterStatuses(session);
		session.context.ui.setFooter(undefined);
	};

	const linkInferredTask = async (
		session: ActiveSession,
		prompt = "",
	): Promise<boolean> => {
		const hasExistingTaskRef: boolean = !!session.state.taskRef;
		if (hasExistingTaskRef) return false;
		const taskRef = inferClaimedTaskRef(
			session.context.sessionManager.getBranch(),
			prompt,
		);
		if (taskRef === undefined) return false;
		try {
			const client = createClient(session.context, dependencies);
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
			appendState(pi, session.state, !session.allowPrDiscovery);
			refreshFooterStatuses(session);
			return true;
		} catch {
			session.context.ui.notify(C.message.taskNotLinked, C.value.warning);
			return false;
		}
	};

	const scheduleSync = (session: ActiveSession): void => {
		const parentRef = session.state.taskRef;
		if (parentRef === undefined) return;
		if (!session.syncAvailable) return;
		cancelScheduledSync(session);
		const generation = session.syncGeneration;
		session.syncTimer = setTimeout(async () => {
			session.syncTimer = undefined;
			const isSyncStale: boolean = !isCurrentSync(active, session, generation);
			if (isSyncStale) return;
			try {
				const store = await readPiTaskStore(taskPath(session));
				await syncPiTasksToTodoist(
					createClient(session.context, dependencies),
					parentRef,
					store ?? { nextId: 1, tasks: [] },
					() => isCurrentSync(active, session, generation),
				);
			} catch {
				const isSyncCurrent: boolean = isCurrentSync(
					active,
					session,
					generation,
				);
				if (isSyncCurrent)
					session.context.ui.notify(
						C.message.taskUpdateFailed,
						C.value.warning,
					);
			}
		}, 25);
	};

	const installTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: C.tool.state,
			label: C.tool.todoist,
			description: C.message.prDescription,
			promptSnippet: C.message.prPrompt,
			parameters: stateParameters,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!active) throw new Error(C.message.inactive);
				const session = active;
				if (params.action === C.action.status) {
					return extensionResult(
						JSON.stringify({
							...session.state,
							codingRoot: session.project.codingRoot,
						}),
					);
				}
				if (params.action === C.action.setPr) {
					const url = githubPrUrl(params.url ?? "");
					if (url === null) throw new Error(C.message.invalidPr);
					const prChanged = session.state.prUrl !== url;
					session.state = applyStatePatch(session.state, {
						prUrl: url,
						...(prChanged
							? {
									mergeCompletedAt: undefined,
									todoistCompletionAttemptedAt: undefined,
								}
							: {}),
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state);
					refreshFooterStatuses(session);
					return extensionResult(`Pinned PR ${url}`);
				}
				if (params.action === C.action.clearPr) {
					session.state = applyStatePatch(session.state, {
						prUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state, true);
					refreshFooterStatuses(session);
					return extensionResult(C.message.prCleared);
				}
				if (params.action === C.action.setTask) {
					if (params.task === undefined) throw new Error(C.message.invalidTask);
					cancelScheduledSync(session);
					const client = createClient(ctx, dependencies);
					const project = await client.resolveProject(
						session.project.todoistProjectRef,
					);
					const claimed = await client.claimTask(params.task, {
						id: project.id,
						currentTaskId: session.state.taskRef,
					});
					await syncTodoistToPiTasks(client, claimed.id, taskPath(session));
					session.syncAvailable = true;
					const taskChanged = session.state.taskRef !== claimed.id;
					session.state = applyStatePatch(session.state, {
						taskRef: claimed.id,
						taskName: claimed.content,
						taskUrl: claimed.webUrl ?? claimed.url,
						...(taskChanged
							? {
									mergeCompletedAt: undefined,
									todoistCompletionAttemptedAt: undefined,
								}
							: {}),
					});
					appendState(pi, session.state, !session.allowPrDiscovery);
					refreshFooterStatuses(session);
					return extensionResult(
						`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
					);
				}
				if (params.action === C.action.clearTask) {
					cancelScheduledSync(session);
					session.state = applyStatePatch(session.state, {
						taskRef: undefined,
						taskName: undefined,
						taskUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					await clearLocalTasks(session);
					appendState(pi, session.state, !session.allowPrDiscovery);
					refreshFooterStatuses(session);
					return extensionResult(C.message.taskCleared);
				}
				cancelScheduledSync(session);
				session.state = {};
				session.allowPrDiscovery = false;
				await clearLocalTasks(session);
				appendState(pi, session.state, true);
				refreshFooterStatuses(session);
				return extensionResult(C.message.stateCleared);
			},
		});
	};

	pi.on(C.event.sessionStart, async (event, ctx) => {
		const config = await (dependencies.loadConfig ?? loadConfig)();
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (!project) {
			if (active) {
				deactivate(active);
				if (pi.getActiveTools && pi.setActiveTools) {
					pi.setActiveTools(
						pi.getActiveTools().filter((name) => name !== C.tool.state),
					);
				}
			}
			active = null;
			return;
		}
		if (active) deactivate(active);
		const branch = ctx.sessionManager.getBranch();
		const stateEntry = latestStateData(branch);
		let state = latestState(branch);
		let handoffContext = false;
		let allowPrDiscovery =
			stateEntry?.prDiscoveryDisabled !== true && !state.prUrl;
		if (stateEntry === null && event.previousSessionFile) {
			const previous: SessionReader =
				dependencies.openSession?.(event.previousSessionFile) ??
				SessionManager.open(event.previousSessionFile);
			const previousProject = resolveConfiguredProject(
				previous.getCwd(),
				config,
			);
			const sameCodingProject =
				previousProject?.codingRoot === project.codingRoot;
			const inherited = sameCodingProject
				? extractInheritedState(previous.getBranch())
				: null;
			if (inherited) {
				state = { ...inherited, inheritedFrom: previous.getSessionId() };
				appendState(pi, state);
				handoffContext = true;
				allowPrDiscovery = false;
			}
		}
		active = {
			context: ctx,
			project,
			state,
			allowPrDiscovery,
			handoffContext,
			workChanged: false,
			syncAvailable: true,
			syncGeneration: 0,
		};
		const taskWasSynced = state.taskRef
			? false
			: await linkInferredTask(active);
		installTool();
		const hasActiveToolReader = typeof pi.getActiveTools === "function";
		const hasActiveToolWriter = typeof pi.setActiveTools === "function";
		const canManageActiveTools = hasActiveToolReader && hasActiveToolWriter;
		const shouldRegisterStateTool = registered && canManageActiveTools;
		if (shouldRegisterStateTool) {
			const activeTools = pi.getActiveTools();
			const shouldAddStateTool: boolean = !activeTools.includes(C.tool.state);
			if (shouldAddStateTool) {
				pi.setActiveTools([...activeTools, C.tool.state]);
			}
		}
		if (ctx.mode === C.value.tui) ctx.ui.setFooter(undefined);
		refreshFooterStatuses(active);
		if (active.allowPrDiscovery)
			persistPrIfAvailable(firstGithubPrUrl(branchTexts(branch)) ?? "");
		if (state.taskRef === undefined || taskWasSynced) return;
		try {
			await syncTodoistToPiTasks(
				createClient(ctx, dependencies),
				state.taskRef,
				taskPath(active),
			);
		} catch {
			active.syncAvailable = false;
			ctx.ui.notify(C.message.taskUpdateFailed, C.value.warning);
		}
	});

	pi.on(C.event.messageEnd, async (event) => {
		if (!active) return;
		persistPrIfAvailable(textOf(event.message));
	});

	pi.on(C.event.beforeAgentStart, async (event, ctx) => {
		if (!active) return;
		const isMissingTaskRef: boolean = !active.state.taskRef;
		if (isMissingTaskRef) {
			await linkInferredTask(active, event.prompt ?? "");
		}
		const messages: string[] = [];
		if (active.handoffContext) {
			messages.push(
				`This is the task and PR that we were working on.\nTask: ${active.state.taskUrl ?? C.value.none}\nPR: ${active.state.prUrl ?? C.value.none}`,
			);
			active.handoffContext = false;
		}
		const isMissingTaskRefForPrompt: boolean = !active.state.taskRef;
		if (isMissingTaskRefForPrompt) messages.push(MISSING_TASK_WARNING);
		if (active.workChanged) {
			const worktree = await inspectWorktree(
				dependencies.exec ?? spawnExec,
				ctx.cwd,
			);
			if (worktree.isWorktree && worktree.branch) {
				const pr = await findOpenPrSafe(
					ctx,
					worktree.branch,
					dependencies.exec ?? spawnExec,
				);
				if (pr === C.value.unknown) messages.push(C.message.lookupUnavailable);
				else if (pr === null) messages.push(C.message.createPr);
			}
		}
		return messages.length
			? {
					message: {
						customType: C.message.context,
						content: messages.join("\n"),
						display: false,
					},
				}
			: undefined;
	});

	pi.on(C.event.toolResult, async (event, ctx) => {
		const shouldIgnoreToolResult = !active || event.isError;
		if (shouldIgnoreToolResult) return;
		if (!active) return;
		const session = active;
		const toolName = String(event.toolName);
		if (toolName === C.tool.edit || toolName === C.tool.write)
			session.workChanged = true;
		if (toolName === C.tool.bash) {
			const command =
				typeof event.input?.command === "string" ? event.input.command : "";
			const resultText = textOf(event.content);
			const isMissingTaskRef: boolean = !session.state.taskRef;
			if (isMissingTaskRef) {
				await linkInferredTask(session, `${command}\n${resultText}`);
			}
			const isGitMutation: boolean =
				!!/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				);
			if (isGitMutation) session.workChanged = true;
			const prUrl = session.state.prUrl;
			const taskRef = session.state.taskRef;
			const hasPrUrl = prUrl !== undefined;
			const hasTaskRef = taskRef !== undefined;
			const hasClaimedTaskAndPr = hasPrUrl && hasTaskRef;
			if (!hasClaimedTaskAndPr) return;
			const isPinnedPr = await matchesPinnedPr(
				dependencies.exec ?? spawnExec,
				ctx.cwd,
				command,
				prUrl,
			);
			if (!isPinnedPr) return;
			if (session.state.todoistCompletionAttemptedAt !== undefined) return;
			try {
				await createClient(ctx, dependencies).completeTask(taskRef);
				session.state = applyStatePatch(session.state, {
					mergeCompletedAt: new Date().toISOString(),
					todoistCompletionAttemptedAt: new Date().toISOString(),
				});
				appendState(pi, session.state);
				ctx.ui.notify(C.message.merged, C.value.info);
			} catch {
				session.state = applyStatePatch(session.state, {
					todoistCompletionAttemptedAt: new Date().toISOString(),
				});
				appendState(pi, session.state);
				ctx.ui.notify(C.message.mergedFailed, C.value.warning);
			}
		}
		const usesTaskTool: boolean = !!taskToolNames.has(toolName);
		if (usesTaskTool) scheduleSync(session);
	});

	pi.on(C.event.agentSettled, () => {
		if (active) scheduleSync(active);
	});

	pi.on(C.event.sessionShutdown, () => {
		if (!active) return;
		deactivate(active);
		active = null;
	});
}

async function findOpenPrSafe(
	ctx: ExtensionContext,
	branch: string,
	exec: Exec,
): Promise<string | null | "unknown"> {
	const result = await findOpenPr(exec, ctx.cwd, branch);
	if (result.state.toLowerCase() === C.value.unknown) return C.value.unknown;
	return result.url;
}
