import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Exec, spawnExec } from "../shared/command.ts";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { TodoistClient } from "./client.ts";
import {
	type ResolvedProject,
	resolveConfiguredProject,
	type TodoistProjectMapping,
} from "./config.ts";
import { renderTaskStatus } from "./footer.ts";
import {
	applyTodoistStatePatch,
	isTodoistState,
	TODOIST_STATE_TYPE,
	type TodoistState,
	todoistContext,
} from "./state.ts";

export interface TodoistSessionReader {
	getBranch(): unknown[];
	getCwd(): string;
}

export interface TodoistModuleDependencies {
	loadConfig?: () => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => TodoistSessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
}

export interface TodoistModule {
	sessionStart(
		event: { previousSessionFile?: string },
		ctx: ExtensionContext,
	): Promise<void>;
	beforeAgentStart(prompt: string): Promise<string>;
	toolResult(input: {
		toolName: string;
		command?: string;
		content?: unknown;
		isError: boolean;
	}): Promise<void>;
	deactivate(): void;
}

const stateParameters = Type.Object({
	action: StringEnum(["status", "set_task", "clear_task"] as const),
	task: Type.Optional(Type.String()),
});

type StateAction =
	| { action: "status" }
	| { action: "set_task"; task?: string }
	| { action: "clear_task" };

type SessionContext = Pick<ExtensionContext, "cwd" | "ui" | "sessionManager">;

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
	if (typeof value === "object" && value !== null && "content" in value)
		return textOf((value as { content?: unknown }).content);
	return "";
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
		const value = match.slice(1).find(Boolean);
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
		if (!CLAIMED_TASK_RE.test(text) || NEGATED_CLAIM_RE.test(text)) continue;
		const associatedTaskRef = textTaskRefs.values().next().value;
		if (associatedTaskRef) return associatedTaskRef;
		hasUnboundClaimEvidence = true;
	}
	return hasUnboundClaimEvidence
		? allTaskRefs.values().next().value
		: undefined;
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

function createClient(
	ctx: ExtensionContext,
	dependencies: TodoistModuleDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) => exec("td", [...args], { cwd: ctx.cwd }),
		})
	);
}

export function createTodoistModule(
	pi: ExtensionAPI,
	project: ResolvedProject,
	config: TodoistProjectMapping,
	dependencies: TodoistModuleDependencies = {},
): TodoistModule {
	let context: SessionContext | null = null;
	let state: TodoistState = {};
	let registered = false;
	let operationGeneration = 0;

	const refreshStatus = (): void => {
		if (!context) return;
		context.ui.setStatus(
			"pi-todo-gate-task",
			renderTaskStatus(state.taskUrl, context.ui.theme, state.taskName),
		);
	};

	const appendState = (): void => {
		appendCustomState(
			(type, data) => pi.appendEntry(type, data),
			TODOIST_STATE_TYPE,
			state,
		);
	};

	const linkInferredTask = async (prompt = ""): Promise<boolean> => {
		if (!context || state.taskRef) return false;
		const taskRef = inferClaimedTaskRef(
			context.sessionManager.getBranch(),
			prompt,
		);
		if (!taskRef) return false;
		const generation = ++operationGeneration;
		try {
			const client = createClient(context as ExtensionContext, dependencies);
			const resolved = await client.resolveProject(project.todoistProjectRef);
			if (generation !== operationGeneration) return false;
			const claimed = await client.claimTask(taskRef, {
				id: resolved.id,
				currentTaskId: taskRef,
			});
			if (generation !== operationGeneration) return false;
			state = applyTodoistStatePatch(state, {
				taskRef: claimed.id,
				taskName: claimed.content,
				taskUrl:
					claimed.webUrl ??
					claimed.url ??
					`https://app.todoist.com/app/task/${claimed.id}`,
			});
			appendState();
			refreshStatus();
			return true;
		} catch {
			if (generation === operationGeneration)
				context.ui.notify(
					"Todoist task was not linked from session history",
					"warning",
				);
			return false;
		}
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: "pi_todoist_gate_state",
			label: "Todoist Gate State",
			description: "Inspect or change this session's claimed Todoist task.",
			promptSnippet: "inspect or update the session Todoist task",
			parameters: stateParameters,
			async execute(_toolCallId, params: StateAction, _signal, _onUpdate, ctx) {
				if (!context) throw new Error("Todoist tracking is inactive");
				if (params.action === "status")
					return extensionResult(
						JSON.stringify({ ...state, codingRoot: project.codingRoot }),
					);
				if (params.action === "set_task") {
					if (!params.task)
						throw new Error("set_task requires a Todoist task reference");
					const generation = ++operationGeneration;
					try {
						const client = createClient(ctx, dependencies);
						const resolved = await client.resolveProject(
							project.todoistProjectRef,
						);
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						const claimed = await client.claimTask(params.task, {
							id: resolved.id,
							currentTaskId: state.taskRef,
						});
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						state = applyTodoistStatePatch(state, {
							taskRef: claimed.id,
							taskName: claimed.content,
							taskUrl: claimed.webUrl ?? claimed.url,
						});
						appendState();
						refreshStatus();
						return extensionResult(
							`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
						);
					} catch (error) {
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						throw error;
					}
				}
				++operationGeneration;
				state = {};
				appendState();
				refreshStatus();
				return extensionResult("Cleared the claimed Todoist task");
			},
		});
	};

	return {
		async sessionStart(event, nextContext) {
			context = nextContext;
			state =
				latestCustomState(
					nextContext.sessionManager.getBranch(),
					TODOIST_STATE_TYPE,
					isTodoistState,
				) ?? {};
			if (!state.taskRef && event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const previousProject = resolveConfiguredProject(
					previous.getCwd(),
					config,
				);
				if (previousProject?.codingRoot === project.codingRoot) {
					state =
						latestCustomState(
							previous.getBranch(),
							TODOIST_STATE_TYPE,
							isTodoistState,
						) ?? {};
					if (state.taskRef) appendState();
				}
			}
			await linkInferredTask();
			registerTool();
			refreshStatus();
		},
		async beforeAgentStart(prompt) {
			if (!context) return "";
			await linkInferredTask(prompt);
			return todoistContext(state, project.todoistProjectRef);
		},
		async toolResult(input) {
			if (!context || input.isError || input.toolName !== "bash") return;
			await linkInferredTask(
				`${input.command ?? ""}\n${textOf(input.content)}`,
			);
		},
		deactivate() {
			++operationGeneration;
			if (context) context.ui.setStatus("pi-todo-gate-task", undefined);
			context = null;
			state = {};
		},
	};
}
