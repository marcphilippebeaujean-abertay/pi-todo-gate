import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, resolveConfiguredProject } from "../src/config.ts";
import { renderPrStatus, renderTaskStatus } from "../src/footer.ts";
import {
	type Exec,
	findOpenPr,
	findPrState,
	inspectWorktree,
	matchesPinnedPr,
	spawnExec,
} from "../src/git.ts";
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
}

const STATE_TYPE = "pi-todo-gate-state";
const DEFAULT_TODOIST_INSTRUCTIONS = `# Todoist Task Gate (MANDATORY — before any code change on a new branch/worktree)

Every code change on a new branch or worktree must be tracked in the Todoist **Merge TD** project (ID
\`6RVXQ9x8qfhxHr4f\`). Before touching any code:

1. **Find or create the task** in Merge TD:
   \`\`\`bash
   td task list --project id:6RVXQ9x8qfhxHr4f
   \`\`\`
    - Match by name against what you're about to do. If a matching task exists, use it.
    - If no task matches, create one: \`td task add "<description>" --project id:6RVXQ9x8qfhxHr4f\`

2. **Check if already claimed:**
   \`\`\`bash
   td task view "<task-ref>"
   \`\`\`
    - If the task is in the **In progress** section → **STOP and alert.** Another agent may be working on it. Do not proceed until the task is free.

3. **Claim the task** by moving it to the **In progress** section:
   \`\`\`bash
   td task move "<task-ref>" --section "In progress" --project id:6RVXQ9x8qfhxHr4f
   \`\`\`

4. **After the PR merges**, complete the task:
   \`\`\`bash
   td task complete "<task-ref>"
   \u0060\u0060\u0060
`;
const ACTIVE_TASK_CONTEXT =
	"We are tracking tasks with Todoist and you are currently working on task";
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
	mergeRetryCount: number;
	mergeRetryExhausted: boolean;
	mergeCompletionInFlight: boolean;
	mergeRetryTimer?: ReturnType<typeof setTimeout>;
	taskOperationGeneration: number;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part) =>
				typeof part === "object" && part !== null && "text" in part
					? String(part.text)
					: "",
			)
			.join(" ");
	if (typeof value === "object" && value !== null && "content" in value) {
		return textOf((value as { content?: unknown }).content);
	}
	return "";
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return { content: [{ type: "text", text }], details: undefined };
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
		if (
			candidate.type === "custom" &&
			candidate.customType === STATE_TYPE &&
			typeof candidate.data === "object" &&
			candidate.data !== null
		) {
			return candidate.data as Record<string, unknown>;
		}
	}
	return null;
}

function branchTexts(entries: readonly unknown[]): string[] {
	return entries
		.filter(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as { type?: unknown }).type !== "custom",
		)
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
	/\b(?:no|not|never)\s+(?:[a-z]+\s+){0,2}claim(?:ed|ing)\s+(?:a\s+)?(?:todoist\s+)?task\b/i;

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
		if (value) matches.add(value);
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
		if (associatedTaskRef) return associatedTaskRef;
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
			run: (args) => exec("td", [...args], { cwd: ctx.cwd }),
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

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	// Todoist state belongs to parent sessions; child sessions must not claim,
	// complete, or otherwise mutate the parent's work tracking.
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	let active: ActiveSession | null = null;
	let registered = false;

	const persistPrIfAvailable = (text: string): void => {
		if (!active?.allowPrDiscovery || active.state.prUrl) return;
		const url = githubPrUrl(text);
		if (!url) return;
		active.state = applyStatePatch(active.state, { prUrl: url });
		active.allowPrDiscovery = false;
		appendState(pi, active.state);
		refreshFooterStatuses(active);
	};

	const beginTaskOperation = (session: ActiveSession): number => {
		session.taskOperationGeneration += 1;
		return session.taskOperationGeneration;
	};

	const isCurrentTaskOperation = (
		session: ActiveSession,
		generation: number,
	): boolean =>
		active === session && session.taskOperationGeneration === generation;

	const refreshFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus(
			"pi-todo-gate-pr",
			renderPrStatus(session.state.prUrl, session.context.ui.theme),
		);
		session.context.ui.setStatus(
			"pi-todo-gate-task",
			renderTaskStatus(
				session.state.taskUrl,
				session.context.ui.theme,
				session.state.taskName,
			),
		);
	};

	const clearFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus("pi-todo-gate-pr", undefined);
		session.context.ui.setStatus("pi-todo-gate-task", undefined);
	};

	const cancelMergeRetry = (session: ActiveSession, reset = false): void => {
		if (session.mergeRetryTimer) {
			clearTimeout(session.mergeRetryTimer);
			session.mergeRetryTimer = undefined;
		}
		if (reset) {
			session.mergeRetryCount = 0;
			session.mergeRetryExhausted = false;
		}
	};

	const deactivate = async (session: ActiveSession): Promise<void> => {
		cancelMergeRetry(session, true);
		session.taskOperationGeneration += 1;
		clearFooterStatuses(session);
		session.context.ui.setFooter(undefined);
	};

	const linkInferredTask = async (
		session: ActiveSession,
		prompt = "",
	): Promise<boolean> => {
		if (session.state.taskRef) return false;
		const taskRef = inferClaimedTaskRef(
			session.context.sessionManager.getBranch(),
			prompt,
		);
		if (!taskRef) return false;
		const generation = beginTaskOperation(session);
		const isCurrent = (): boolean =>
			isCurrentTaskOperation(session, generation);
		try {
			const client = createClient(session.context, dependencies);
			const project = await client.resolveProject(
				session.project.todoistProjectRef,
			);
			if (!isCurrent()) return false;
			const claimed = await client.claimTask(taskRef, {
				id: project.id,
				currentTaskId: taskRef,
			});
			if (!isCurrent()) return false;
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
			if (!isCurrent()) return false;
			session.context.ui.notify(
				"Todoist task was not linked from session history",
				"warning",
			);
			return false;
		}
	};

	const completeMergedTask = async (
		session: ActiveSession,
		expected?: { prUrl: string; taskRef: string },
	): Promise<boolean> => {
		const prUrl = session.state.prUrl;
		const taskRef = session.state.taskRef;
		const taskGeneration = session.taskOperationGeneration;
		if (
			!prUrl ||
			!taskRef ||
			session.mergeRetryExhausted ||
			session.mergeCompletionInFlight ||
			(expected && (prUrl !== expected.prUrl || taskRef !== expected.taskRef))
		)
			return false;
		cancelMergeRetry(session);
		session.mergeCompletionInFlight = true;
		const isCurrent = (): boolean =>
			active === session &&
			session.taskOperationGeneration === taskGeneration &&
			session.state.prUrl === prUrl &&
			session.state.taskRef === taskRef;
		try {
			await createClient(session.context, dependencies).completeTask(taskRef);
			if (!isCurrent()) return false;
			session.state = applyStatePatch(session.state, {
				prUrl: undefined,
				mergeCompletedAt: new Date().toISOString(),
				todoistCompletionAttemptedAt: new Date().toISOString(),
			});
			session.mergeRetryCount = 0;
			session.mergeRetryExhausted = false;
			appendState(pi, session.state, true);
			refreshFooterStatuses(session);
			session.context.ui.notify(
				"Merged PR detected; Todoist task completed",
				"info",
			);
			return true;
		} catch {
			if (!isCurrent()) return false;
			session.state = applyStatePatch(session.state, {
				todoistCompletionAttemptedAt: new Date().toISOString(),
			});
			appendState(pi, session.state);
			session.context.ui.notify(
				"Merged PR detected, but Todoist task completion failed",
				"warning",
			);
			scheduleMergeRetry(session, prUrl, taskRef);
			return false;
		} finally {
			session.mergeCompletionInFlight = false;
		}
	};

	const scheduleMergeRetry = (
		session: ActiveSession,
		prUrl: string,
		taskRef: string,
	): void => {
		const maxRetries = 3;
		if (session.mergeRetryCount >= maxRetries) {
			session.mergeRetryExhausted = true;
			return;
		}
		const retryNumber = session.mergeRetryCount;
		session.mergeRetryCount += 1;
		session.mergeRetryTimer = setTimeout(
			async () => {
				session.mergeRetryTimer = undefined;
				if (
					active !== session ||
					session.state.prUrl !== prUrl ||
					session.state.taskRef !== taskRef
				)
					return;
				await completeMergedTask(session, { prUrl, taskRef });
			},
			100 * 2 ** retryNumber,
		);
	};

	const completeExternallyMergedTask = async (
		session: ActiveSession,
	): Promise<void> => {
		if (!session.state.prUrl || !session.state.taskRef) return;
		const prUrl = session.state.prUrl;
		const taskRef = session.state.taskRef;
		const taskGeneration = session.taskOperationGeneration;
		const state = await findPrState(
			dependencies.exec ?? spawnExec,
			session.context.cwd,
			prUrl,
		);
		if (
			state === "MERGED" &&
			active === session &&
			session.taskOperationGeneration === taskGeneration &&
			session.state.prUrl === prUrl &&
			session.state.taskRef === taskRef
		)
			await completeMergedTask(session, { prUrl, taskRef });
	};

	const installTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: "pi_todo_gate_state",
			label: "Todo Gate State",
			description:
				"Inspect or change this session's pinned GitHub PR and claimed Todoist task.",
			promptSnippet: "inspect or update the session PR and Todoist task",
			parameters: stateParameters,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!active)
					throw new Error("pi-todo-gate is inactive for this project");
				const session = active;
				if (params.action === "status") {
					return extensionResult(
						JSON.stringify({
							...session.state,
							codingRoot: session.project.codingRoot,
						}),
					);
				}
				if (params.action === "set_pr") {
					const url = githubPrUrl(params.url ?? "");
					if (!url)
						throw new Error("set_pr requires a valid GitHub pull request URL");
					cancelMergeRetry(session, true);
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
				if (params.action === "clear_pr") {
					cancelMergeRetry(session, true);
					session.state = applyStatePatch(session.state, {
						prUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state, true);
					refreshFooterStatuses(session);
					return extensionResult("Cleared the pinned PR");
				}
				if (params.action === "set_task") {
					if (!params.task)
						throw new Error("set_task requires a Todoist task reference");
					cancelMergeRetry(session, true);
					const generation = beginTaskOperation(session);
					const isCurrent = (): boolean =>
						isCurrentTaskOperation(session, generation);
					try {
						const client = createClient(ctx, dependencies);
						const project = await client.resolveProject(
							session.project.todoistProjectRef,
						);
						if (!isCurrent())
							return extensionResult("Todoist task change superseded");
						const claimed = await client.claimTask(params.task, {
							id: project.id,
							currentTaskId: session.state.taskRef,
						});
						if (!isCurrent())
							return extensionResult("Todoist task change superseded");
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
					} catch (error) {
						if (!isCurrent())
							return extensionResult("Todoist task change superseded");
						throw error;
					}
				}
				if (params.action === "clear_task") {
					cancelMergeRetry(session, true);
					beginTaskOperation(session);
					session.state = applyStatePatch(session.state, {
						taskRef: undefined,
						taskName: undefined,
						taskUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					appendState(pi, session.state, !session.allowPrDiscovery);
					refreshFooterStatuses(session);
					return extensionResult("Cleared the claimed Todoist task");
				}
				cancelMergeRetry(session, true);
				beginTaskOperation(session);
				session.state = {};
				session.allowPrDiscovery = false;
				appendState(pi, session.state, true);
				refreshFooterStatuses(session);
				return extensionResult("Cleared session PR and task links");
			},
		});
	};

	pi.on("session_start", async (event, ctx) => {
		const config = await (dependencies.loadConfig ?? loadConfig)();
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (!project) {
			if (active) {
				await deactivate(active);
				if (pi.getActiveTools && pi.setActiveTools) {
					pi.setActiveTools(
						pi.getActiveTools().filter((name) => name !== "pi_todo_gate_state"),
					);
				}
			}
			active = null;
			return;
		}
		if (active) await deactivate(active);
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
			mergeRetryCount: 0,
			mergeRetryExhausted: false,
			mergeCompletionInFlight: false,
			taskOperationGeneration: 0,
		};
		await linkInferredTask(active);
		installTool();
		if (registered && pi.getActiveTools && pi.setActiveTools) {
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes("pi_todo_gate_state")) {
				pi.setActiveTools([...activeTools, "pi_todo_gate_state"]);
			}
		}
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
		refreshFooterStatuses(active);
		if (active.allowPrDiscovery)
			persistPrIfAvailable(firstGithubPrUrl(branchTexts(branch)) ?? "");
		await completeExternallyMergedTask(active);
	});

	pi.on("message_end", async (event) => {
		if (!active) return;
		persistPrIfAvailable(textOf(event.message));
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!active) return;
		if (!active.state.taskRef) {
			await linkInferredTask(active, event.prompt ?? "");
		}
		await completeExternallyMergedTask(active);
		const messages: string[] = [];
		if (active.handoffContext) {
			messages.push(
				`This is the task and PR that we were working on.\nTask: ${active.state.taskUrl ?? "none"}\nPR: ${active.state.prUrl ?? "none"}`,
			);
			active.handoffContext = false;
		}
		if (active.state.taskRef) {
			messages.push(`${ACTIVE_TASK_CONTEXT} ${active.state.taskRef}`);
		} else {
			messages.push(DEFAULT_TODOIST_INSTRUCTIONS);
		}
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
				if (pr === "unknown")
					messages.push(
						"GitHub PR lookup unavailable; verify gh authentication before creating the PR.",
					);
				else if (pr === null)
					messages.push(
						"When implementation is finished, push this branch and create a GitHub PR.",
					);
			}
		}
		return messages.length
			? {
					message: {
						customType: "pi-todo-gate-context",
						content: messages.join("\n"),
						display: false,
					},
				}
			: undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!active || event.isError) return;
		const toolName = String(event.toolName);
		if (toolName === "edit" || toolName === "write") active.workChanged = true;
		if (toolName === "bash") {
			const command =
				typeof event.input?.command === "string" ? event.input.command : "";
			const resultText = textOf(event.content);
			if (!active.state.taskRef) {
				await linkInferredTask(active, `${command}\n${resultText}`);
			}
			if (
				/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				)
			)
				active.workChanged = true;
			const session = active;
			const prUrl = session.state.prUrl;
			const taskRef = session.state.taskRef;
			const taskGeneration = session.taskOperationGeneration;
			if (
				prUrl &&
				taskRef &&
				(await matchesPinnedPr(
					dependencies.exec ?? spawnExec,
					ctx.cwd,
					command,
					prUrl,
				)) &&
				active === session &&
				session.taskOperationGeneration === taskGeneration &&
				session.state.prUrl === prUrl &&
				session.state.taskRef === taskRef
			)
				await completeMergedTask(session, { prUrl, taskRef });
		}
	});

	pi.on("session_shutdown", async () => {
		if (!active) return;
		await deactivate(active);
		active = null;
	});
}

async function findOpenPrSafe(
	ctx: ExtensionContext,
	branch: string,
	exec: Exec,
): Promise<string | null | "unknown"> {
	const result = await findOpenPr(exec, ctx.cwd, branch);
	if (result.state === "UNKNOWN") return "unknown";
	return result.url;
}
