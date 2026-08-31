const STRING_LITERAL_TEXT_2BA29EAE = "text";
const STRING_LITERAL_GITHUB_PR_LOOKUP_UNAVAILABLE_VERIFY_C0911CB1 =
	"GitHub PR lookup unavailable; verify gh authentication before creating the PR.";
const STRING_LITERAL_WHEN_IMPLEMENTATION_IS_FINISHED_PUSH_464201E3 =
	"When implementation is finished, push this branch and create a GitHub PR.";
const STRING_LITERAL_PI_TODO_GATE_PR_B2A58C93 = "pi-todo-gate-pr";
const STRING_LITERAL_UNKNOWN_2CE642B8 = "UNKNOWN";
const STRING_LITERAL_MERGED_F1388D9D = "MERGED";
const STRING_LITERAL_PI_PR_GATE_STATE_6929882B = "pi_pr_gate_state";
const STRING_LITERAL_PR_GATE_STATE_0634C700 = "PR Gate State";
const STRING_LITERAL_INSPECT_OR_CHANGE_THIS_SESSION_720038D2 =
	"Inspect or change this session's pinned GitHub PR.";
const STRING_LITERAL_INSPECT_OR_UPDATE_THE_SESSION_7823DD0F =
	"inspect or update the session GitHub PR";
const STRING_LITERAL_PR_TRACKING_IS_INACTIVE_AA9BD94F =
	"PR tracking is inactive";
const STRING_LITERAL_PR_TRACKING_IS_INITIALIZING_4EAB15B8 =
	"PR tracking is initializing";
const STRING_LITERAL_SET_PR_REQUIRES_A_VALID_EAFE7B2D =
	"set_pr requires a valid GitHub pull request URL";
const STRING_LITERAL_PR_CHANGE_SUPERSEDED_FE7B967F = "PR change superseded";
const STRING_LITERAL_SET_PR_REQUIRES_AN_EXISTING_171076F6 =
	"set_pr requires an existing GitHub pull request";
const STRING_LITERAL_CLEARED_THE_PINNED_PR_C838A013 = "Cleared the pinned PR";

import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Exec, spawnExec } from "../shared/command.ts";
import { detectMerge, type MergeEvent } from "../shared/merge-detection.ts";
import { inspectProject } from "../shared/project.ts";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { githubPrUrl, githubPrUrls } from "./detection.ts";
import { renderPrStatus } from "./footer.ts";
import { findOpenPr, findPrState } from "./git.ts";
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
	messageEnd(text: string): Promise<void>;
	beforeAgentStart(): Promise<string[]>;
	toolResult(input: {
		toolName: string;
		command?: string;
		content?: unknown;
		isError: boolean;
	}): Promise<MergeEvent | null>;
	drainMergeEvents(): MergeEvent[];
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
	return {
		content: [{ type: STRING_LITERAL_TEXT_2BA29EAE, text }],
		details: undefined,
	};
}

function unmergedPrUrls(
	texts: readonly string[],
	mergedPrs: readonly string[],
): string[] {
	const merged = new Set(mergedPrs);
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const text of texts) {
		for (const url of githubPrUrls(text)) {
			if (!merged.has(url) && !seen.has(url)) {
				seen.add(url);
				candidates.push(url);
			}
		}
	}
	return candidates;
}

async function findOpenPrMessage(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<string | undefined> {
	const result = await findOpenPr(exec, cwd, branch);
	if (result.state === "UNKNOWN")
		return STRING_LITERAL_GITHUB_PR_LOOKUP_UNAVAILABLE_VERIFY_C0911CB1;
	if (result.url === null)
		return STRING_LITERAL_WHEN_IMPLEMENTATION_IS_FINISHED_PUSH_464201E3;
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
	let operationGeneration = 0;
	let ready = false;
	let mergeEvents: MergeEvent[] = [];

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
			STRING_LITERAL_PI_TODO_GATE_PR_B2A58C93,
			renderPrStatus(state.prUrl, context.ui.theme),
		);
	};

	const setDiscoveredPr = async (
		urls: readonly string[],
		generation: number,
	): Promise<void> => {
		for (const url of urls) {
			if (generation !== operationGeneration || !context) return;
			const prState = await findPrState(
				dependencies.exec ?? spawnExec,
				context.cwd,
				url,
			);
			if (generation !== operationGeneration || !context) return;
			if (prState === STRING_LITERAL_UNKNOWN_2CE642B8) continue;
			state = { ...state, prUrl: url, discoveryDisabled: false };
			allowDiscovery = false;
			appendState();
			refreshStatus();
			return;
		}
	};

	const recordMerge = (): MergeEvent | null => {
		if (!state.prUrl) return null;
		const event = { prUrl: state.prUrl };
		state = recordMergedPr(state, new Date().toISOString());
		mergeEvents.push(event);
		allowDiscovery = true;
		appendState();
		refreshStatus();
		return event;
	};

	const checkExternalMerge = async (
		generation = operationGeneration,
	): Promise<void> => {
		if (!context || !state.prUrl) return;
		const prUrl = state.prUrl;
		const prState = await findPrState(
			dependencies.exec ?? spawnExec,
			context.cwd,
			prUrl,
		);
		if (generation !== operationGeneration || !context || state.prUrl !== prUrl)
			return;
		if (prState === STRING_LITERAL_MERGED_F1388D9D) recordMerge();
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: STRING_LITERAL_PI_PR_GATE_STATE_6929882B,
			label: STRING_LITERAL_PR_GATE_STATE_0634C700,
			description: STRING_LITERAL_INSPECT_OR_CHANGE_THIS_SESSION_720038D2,
			promptSnippet: STRING_LITERAL_INSPECT_OR_UPDATE_THE_SESSION_7823DD0F,
			parameters: stateParameters,
			async execute(_toolCallId, params: StateAction) {
				if (!context)
					throw new Error(STRING_LITERAL_PR_TRACKING_IS_INACTIVE_AA9BD94F);
				if (!ready)
					throw new Error(STRING_LITERAL_PR_TRACKING_IS_INITIALIZING_4EAB15B8);
				if (params.action === "status")
					return extensionResult(
						JSON.stringify({ ...state, codingRoot: projectRoot }),
					);
				if (params.action === "set_pr") {
					const url = githubPrUrl(params.url ?? "");
					if (!url)
						throw new Error(STRING_LITERAL_SET_PR_REQUIRES_A_VALID_EAFE7B2D);
					const generation = ++operationGeneration;
					const prState = await findPrState(
						dependencies.exec ?? spawnExec,
						context.cwd,
						url,
					);
					if (generation !== operationGeneration)
						return extensionResult(
							STRING_LITERAL_PR_CHANGE_SUPERSEDED_FE7B967F,
						);
					if (prState === STRING_LITERAL_UNKNOWN_2CE642B8)
						throw new Error(
							STRING_LITERAL_SET_PR_REQUIRES_AN_EXISTING_171076F6,
						);
					state = removeMergedPr({ ...state, prUrl: url }, url);
					state = { ...state, prUrl: url, discoveryDisabled: true };
					allowDiscovery = false;
					appendState();
					refreshStatus();
					return extensionResult(`Pinned PR ${url}`);
				}
				++operationGeneration;
				state = { ...state, prUrl: undefined, discoveryDisabled: true };
				allowDiscovery = false;
				appendState();
				refreshStatus();
				return extensionResult(STRING_LITERAL_CLEARED_THE_PINNED_PR_C838A013);
			},
		});
	};

	return {
		async sessionStart(event, nextContext) {
			const generation = ++operationGeneration;
			ready = false;
			mergeEvents = [];
			context = nextContext;
			state = {};
			workChanged = false;
			allowDiscovery = false;
			const project = await inspectProject(
				dependencies.exec ?? spawnExec,
				nextContext.cwd,
			);
			if (generation !== operationGeneration) return;
			projectRoot = project.root;
			const currentState = latestCustomState(
				nextContext.sessionManager.getBranch(),
				PR_STATE_TYPE,
				isPrState,
			);
			state = currentState ?? {};
			if (!currentState && event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const previousProject = await inspectProject(
					dependencies.exec ?? spawnExec,
					previous.getCwd(),
				);
				if (generation !== operationGeneration) return;
				if (projectRoot && projectRoot === previousProject.root) {
					const inherited = latestCustomState(
						previous.getBranch(),
						PR_STATE_TYPE,
						isPrState,
					);
					if (inherited) {
						let canInherit = true;
						if (inherited.prUrl) {
							const inheritedPrState = await findPrState(
								dependencies.exec ?? spawnExec,
								context?.cwd ?? nextContext.cwd,
								inherited.prUrl,
							);
							if (generation !== operationGeneration) return;
							canInherit = inheritedPrState !== STRING_LITERAL_UNKNOWN_2CE642B8;
						}
						if (canInherit) {
							state = inherited;
							appendState();
						}
					}
				}
			}
			allowDiscovery = !state.discoveryDisabled && !state.prUrl;
			if (allowDiscovery) {
				const urls = unmergedPrUrls(
					branchTexts(nextContext.sessionManager.getBranch()),
					mergedUrls(state),
				);
				if (urls.length) await setDiscoveredPr(urls, generation);
			}
			if (generation !== operationGeneration) return;
			registerTool();
			refreshStatus();
			await checkExternalMerge(generation);
			if (generation !== operationGeneration || !context) return;
			ready = true;
		},
		async messageEnd(text) {
			if (!ready || !allowDiscovery || state.prUrl) return;
			const generation = ++operationGeneration;
			const urls = unmergedPrUrls([text], mergedUrls(state));
			if (urls.length) await setDiscoveredPr(urls, generation);
		},
		async beforeAgentStart() {
			if (!context || !ready) return [];
			const generation = operationGeneration;
			await checkExternalMerge(generation);
			if (generation !== operationGeneration || !context) return [];
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
				if (generation !== operationGeneration || !context) return [];
				if (project.isWorktree && project.branch) {
					const message = await findOpenPrMessage(
						dependencies.exec ?? spawnExec,
						context.cwd,
						project.branch,
					);
					if (generation !== operationGeneration || !context) return [];
					if (message) messages.push(message);
				}
			}
			return messages;
		},
		async toolResult(input) {
			if (!context || !ready || input.isError) return null;
			if (input.toolName === "edit" || input.toolName === "write")
				workChanged = true;
			if (input.toolName !== "bash") return null;
			const command = input.command ?? "";
			const generation = operationGeneration;
			const prUrl = state.prUrl;
			if (
				/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				)
			)
				workChanged = true;
			const mergeEvent = prUrl
				? await detectMerge(
						dependencies.exec ?? spawnExec,
						context.cwd,
						command,
						prUrl,
					)
				: null;
			if (
				mergeEvent &&
				generation === operationGeneration &&
				context &&
				state.prUrl === mergeEvent.prUrl
			)
				return recordMerge();
			return null;
		},
		drainMergeEvents() {
			const events = mergeEvents;
			mergeEvents = [];
			return events;
		},
		deactivate() {
			++operationGeneration;
			ready = false;
			workChanged = false;
			mergeEvents = [];
			state = {};
			if (context)
				context.ui.setStatus(
					STRING_LITERAL_PI_TODO_GATE_PR_B2A58C93,
					undefined,
				);
			context = null;
		},
	};
}
