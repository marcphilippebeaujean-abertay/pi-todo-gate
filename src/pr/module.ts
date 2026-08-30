import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Exec, spawnExec } from "../shared/command.ts";
import { inspectProject } from "../shared/project.ts";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { firstUnmergedGithubPrUrl, githubPrUrl } from "./detection.ts";
import { renderPrStatus } from "./footer.ts";
import { findOpenPr, findPrState, matchesPinnedPr } from "./git.ts";
import {
	isPrState,
	markRemindersDelivered,
	mergedUrls,
	PR_STATE_TYPE,
	type PrState,
	recordMergedPr,
	removeMergedPr,
} from "./state.ts";

const MERGE_REMINDER =
	"Please ensure you have closed all completed tasks for this session if you have been using task tracking";

export interface PrSessionReader {
	getBranch(): unknown[];
	getCwd(): string;
}

export interface PrModuleDependencies {
	openSession?: (path: string) => PrSessionReader;
	exec?: Exec;
}

export interface PrModule {
	sessionStart(
		event: { previousSessionFile?: string },
		ctx: ExtensionContext,
	): Promise<void>;
	messageEnd(text: string): void;
	beforeAgentStart(): Promise<string[]>;
	toolResult(input: {
		toolName: string;
		command?: string;
		content?: unknown;
		isError: boolean;
	}): Promise<void>;
	deactivate(): void;
}

const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr"] as const),
	url: Type.Optional(Type.String()),
});

type StateAction =
	| { action: "status" }
	| { action: "set_pr"; url?: string }
	| { action: "clear_pr" };

type SessionContext = Pick<ExtensionContext, "cwd" | "ui" | "sessionManager">;

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

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

async function findOpenPrMessage(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<string | undefined> {
	const result = await findOpenPr(exec, cwd, branch);
	if (result.state === "UNKNOWN")
		return "GitHub PR lookup unavailable; verify gh authentication before creating the PR.";
	if (result.url === null)
		return "When implementation is finished, push this branch and create a GitHub PR.";
	return undefined;
}

export function createPrModule(
	pi: ExtensionAPI,
	dependencies: PrModuleDependencies = {},
): PrModule {
	let context: SessionContext | null = null;
	let state: PrState = {};
	let projectRoot: string | null = null;
	let allowDiscovery = true;
	let workChanged = false;
	let registered = false;

	const appendState = (): void => {
		appendCustomState(
			(type, data) => pi.appendEntry(type, data),
			PR_STATE_TYPE,
			state,
		);
	};

	const refreshStatus = (): void => {
		if (!context) return;
		context.ui.setStatus(
			"pi-todo-gate-pr",
			renderPrStatus(state.prUrl, context.ui.theme),
		);
	};

	const setDiscoveredPr = (url: string): void => {
		state = { ...state, prUrl: url, discoveryDisabled: false };
		allowDiscovery = false;
		appendState();
		refreshStatus();
	};

	const recordMerge = (): void => {
		if (!state.prUrl) return;
		state = recordMergedPr(state, new Date().toISOString());
		allowDiscovery = true;
		appendState();
		refreshStatus();
	};

	const checkExternalMerge = async (): Promise<void> => {
		if (!context || !state.prUrl) return;
		const prUrl = state.prUrl;
		if (
			(await findPrState(
				dependencies.exec ?? spawnExec,
				context.cwd,
				prUrl,
			)) === "MERGED" &&
			state.prUrl === prUrl
		)
			recordMerge();
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: "pi_pr_gate_state",
			label: "PR Gate State",
			description: "Inspect or change this session's pinned GitHub PR.",
			promptSnippet: "inspect or update the session GitHub PR",
			parameters: stateParameters,
			async execute(_toolCallId, params: StateAction) {
				if (!context) throw new Error("PR tracking is inactive");
				if (params.action === "status")
					return extensionResult(
						JSON.stringify({ ...state, codingRoot: projectRoot }),
					);
				if (params.action === "set_pr") {
					const url = githubPrUrl(params.url ?? "");
					if (!url)
						throw new Error("set_pr requires a valid GitHub pull request URL");
					state = removeMergedPr({ ...state, prUrl: url }, url);
					state = { ...state, prUrl: url, discoveryDisabled: true };
					allowDiscovery = false;
					appendState();
					refreshStatus();
					return extensionResult(`Pinned PR ${url}`);
				}
				state = { ...state, prUrl: undefined, discoveryDisabled: true };
				allowDiscovery = false;
				appendState();
				refreshStatus();
				return extensionResult("Cleared the pinned PR");
			},
		});
	};

	return {
		async sessionStart(event, nextContext) {
			context = nextContext;
			const project = await inspectProject(
				dependencies.exec ?? spawnExec,
				nextContext.cwd,
			);
			projectRoot = project.root;
			state =
				latestCustomState(
					nextContext.sessionManager.getBranch(),
					PR_STATE_TYPE,
					isPrState,
				) ?? {};
			if (!state.prUrl && event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const previousProject = await inspectProject(
					dependencies.exec ?? spawnExec,
					previous.getCwd(),
				);
				if (projectRoot && projectRoot === previousProject.root) {
					const inherited = latestCustomState(
						previous.getBranch(),
						PR_STATE_TYPE,
						isPrState,
					);
					if (inherited) {
						state = inherited;
						appendState();
					}
				}
			}
			allowDiscovery = !state.discoveryDisabled && !state.prUrl;
			if (allowDiscovery) {
				const url = firstUnmergedGithubPrUrl(
					branchTexts(nextContext.sessionManager.getBranch()),
					mergedUrls(state),
				);
				if (url) setDiscoveredPr(url);
			}
			registerTool();
			refreshStatus();
			await checkExternalMerge();
		},
		messageEnd(text) {
			if (!allowDiscovery || state.prUrl) return;
			const url = firstUnmergedGithubPrUrl([text], mergedUrls(state));
			if (url) setDiscoveredPr(url);
		},
		async beforeAgentStart() {
			if (!context) return [];
			await checkExternalMerge();
			const messages: string[] = [];
			if (state.mergedPrs?.some((entry) => entry.reminderPending)) {
				messages.push(MERGE_REMINDER);
				state = markRemindersDelivered(state);
				appendState();
			}
			if (workChanged) {
				const project = await inspectProject(
					dependencies.exec ?? spawnExec,
					context.cwd,
				);
				if (project.isWorktree && project.branch) {
					const message = await findOpenPrMessage(
						dependencies.exec ?? spawnExec,
						context.cwd,
						project.branch,
					);
					if (message) messages.push(message);
				}
			}
			return messages;
		},
		async toolResult(input) {
			if (!context || input.isError) return;
			if (input.toolName === "edit" || input.toolName === "write")
				workChanged = true;
			if (input.toolName !== "bash") return;
			const command = input.command ?? "";
			if (
				/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				)
			)
				workChanged = true;
			if (
				state.prUrl &&
				(await matchesPinnedPr(
					dependencies.exec ?? spawnExec,
					context.cwd,
					command,
					state.prUrl,
				))
			)
				recordMerge();
		},
		deactivate() {
			if (context) context.ui.setStatus("pi-todo-gate-pr", undefined);
			context = null;
		},
	};
}
