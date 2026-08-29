import { resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, resolveConfiguredProject } from "../src/config.ts";
import { createFooterFactory } from "../src/footer.ts";
import {
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	spawnExec,
} from "../src/git.ts";
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

function taskPath(active: ActiveSession): string {
	return sessionTaskPath(
		active.project.codingRoot,
		active.context.sessionManager.getSessionId(),
	);
}

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	let active: ActiveSession | null = null;
	let registered = false;

	const persistPrIfAvailable = (text: string): void => {
		if (!active?.allowPrDiscovery || active.state.prUrl) return;
		const url = githubPrUrl(text);
		if (!url) return;
		active.state = applyStatePatch(active.state, { prUrl: url });
		active.allowPrDiscovery = false;
		appendState(pi, active.state);
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

	const scheduleSync = (session: ActiveSession): void => {
		const parentRef = session.state.taskRef;
		if (!parentRef || !session.syncAvailable) return;
		cancelScheduledSync(session);
		const generation = session.syncGeneration;
		session.syncTimer = setTimeout(async () => {
			session.syncTimer = undefined;
			if (generation !== session.syncGeneration || !session.syncAvailable)
				return;
			try {
				const store = await readPiTaskStore(taskPath(session));
				await syncPiTasksToTodoist(
					createClient(session.context, dependencies),
					parentRef,
					store ?? { nextId: 1, tasks: [] },
				);
			} catch {
				session.context.ui.notify("Todoist task update failed", "warning");
			}
		}, 25);
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
					return extensionResult(`Pinned PR ${url}`);
				}
				if (params.action === "clear_pr") {
					session.state = applyStatePatch(session.state, {
						prUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state, true);
					return extensionResult("Cleared the pinned PR");
				}
				if (params.action === "set_task") {
					if (!params.task)
						throw new Error("set_task requires a Todoist task reference");
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
						taskUrl: claimed.webUrl ?? claimed.url,
						...(taskChanged
							? {
									mergeCompletedAt: undefined,
									todoistCompletionAttemptedAt: undefined,
								}
							: {}),
					});
					appendState(pi, session.state, !session.allowPrDiscovery);
					return extensionResult(
						`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
					);
				}
				if (params.action === "clear_task") {
					cancelScheduledSync(session);
					session.state = applyStatePatch(session.state, {
						taskRef: undefined,
						taskUrl: undefined,
					});
					await clearLocalTasks(session);
					appendState(pi, session.state, !session.allowPrDiscovery);
					return extensionResult("Cleared the claimed Todoist task");
				}
				cancelScheduledSync(session);
				session.state = {};
				session.allowPrDiscovery = false;
				await clearLocalTasks(session);
				appendState(pi, session.state, true);
				return extensionResult("Cleared session PR and task links");
			},
		});
	};

	pi.on("session_start", async (event, ctx) => {
		const config = await (dependencies.loadConfig ?? loadConfig)();
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (!project) {
			if (active) {
				cancelScheduledSync(active);
				active.context.ui.setFooter(undefined);
				if (pi.getActiveTools && pi.setActiveTools) {
					pi.setActiveTools(
						pi.getActiveTools().filter((name) => name !== "pi_todo_gate_state"),
					);
				}
			}
			active = null;
			return;
		}
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
			const previousCwd = resolve(previous.getCwd());
			const sameCodingProject =
				previousCwd === project.codingRoot ||
				previousCwd.startsWith(`${project.codingRoot}/`);
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
		installTool();
		if (registered && pi.getActiveTools && pi.setActiveTools) {
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes("pi_todo_gate_state")) {
				pi.setActiveTools([...activeTools, "pi_todo_gate_state"]);
			}
		}
		if (ctx.mode === "tui") {
			const footerFactory = createFooterFactory(() => ({
				prUrl: active?.state.prUrl,
				taskUrl: active?.state.taskUrl,
			}));
			ctx.ui.setFooter((tui, theme, footerData) =>
				footerFactory(tui, theme, {
					getExtensionStatuses: () => footerData.getExtensionStatuses(),
					getGitBranch: () => footerData.getGitBranch(),
					onBranchChange: (listener) => footerData.onBranchChange(listener),
				}),
			);
		}
		if (active.allowPrDiscovery)
			persistPrIfAvailable(firstGithubPrUrl(branchTexts(branch)) ?? "");
		if (state.taskRef) {
			try {
				await syncTodoistToPiTasks(
					createClient(ctx, dependencies),
					state.taskRef,
					taskPath(active),
				);
			} catch {
				active.syncAvailable = false;
				ctx.ui.notify("Todoist task restore failed", "warning");
			}
		}
	});

	pi.on("message_end", async (event) => {
		if (!active) return;
		persistPrIfAvailable(textOf(event.message));
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!active) return;
		const messages: string[] = [];
		if (active.handoffContext) {
			messages.push(
				`This is the task and PR that we were working on.\nTask: ${active.state.taskUrl ?? "none"}\nPR: ${active.state.prUrl ?? "none"}`,
			);
			active.handoffContext = false;
		}
		if (!active.state.taskRef) messages.push(MISSING_TASK_WARNING);
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
			if (
				/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				)
			)
				active.workChanged = true;
			if (
				active.state.prUrl &&
				active.state.taskRef &&
				(await matchesPinnedPr(
					dependencies.exec ?? spawnExec,
					ctx.cwd,
					command,
					active.state.prUrl,
				))
			) {
				if (!active.state.todoistCompletionAttemptedAt) {
					try {
						await createClient(ctx, dependencies).completeTask(
							active.state.taskRef,
						);
						active.state = applyStatePatch(active.state, {
							mergeCompletedAt: new Date().toISOString(),
							todoistCompletionAttemptedAt: new Date().toISOString(),
						});
						appendState(pi, active.state);
						ctx.ui.notify("Merged PR detected; Todoist task completed", "info");
					} catch {
						active.state = applyStatePatch(active.state, {
							todoistCompletionAttemptedAt: new Date().toISOString(),
						});
						appendState(pi, active.state);
						ctx.ui.notify(
							"Merged PR detected, but Todoist task completion failed",
							"warning",
						);
					}
				}
			}
		}
		if (taskToolNames.has(toolName)) scheduleSync(active);
	});

	pi.on("agent_settled", () => {
		if (active) scheduleSync(active);
	});

	pi.on("session_shutdown", () => {
		if (!active) return;
		cancelScheduledSync(active);
		active.context.ui.setFooter(undefined);
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
