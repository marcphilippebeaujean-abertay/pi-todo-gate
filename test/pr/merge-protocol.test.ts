import { readFile } from "node:fs/promises";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	mergeProtocolSkillPath,
	registerMergeProtocol,
} from "../../src/pr/module.ts";
import type { PrCommandOptions } from "../../src/pr/state.ts";
import type { CommandResult } from "../../src/shared/command.ts";
import type { ExtensionDependencies, SessionRecord } from "../../src/state.ts";

const PR_URL = "https://github.com/o/r/pull/42";
const cwd = "/repo";

function commandContext(confirm = true): ExtensionCommandContext {
	return {
		cwd,
		hasUI: true,
		ui: {
			confirm: vi.fn(async () => confirm),
			notify: vi.fn(),
		},
	} as unknown as ExtensionCommandContext;
}

function createRuntime(
	exec: ExtensionDependencies["exec"],
	confirm = true,
): {
	runtime: PrCommandOptions;
	context: ExtensionCommandContext;
	session: SessionRecord;
} {
	const context = commandContext(confirm);
	const session = {
		sessionId: "session",
		context,
		state: { prUrl: PR_URL, taskRef: "task-1" },
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
		workRevision: 0,
	} as unknown as SessionRecord;
	const activeSession = { current: session };
	const sessionState = {
		sessionId: session.sessionId,
		gitState: {},
		moduleState: {},
	};
	const currentRuntime = {
		sessionState,
		exec,
		getSession: () => activeSession.current,
		getPrState: () => ({
			operationGeneration: activeSession.current?.operationGeneration,
		}),
		isCurrentOperation: (current: SessionRecord, generation: number) =>
			current.operationGeneration === generation,
		enqueueSessionOperation: <T>(
			_session: SessionRecord,
			operation: () => Promise<T>,
		) => operation(),
		eventHandler: {
			prMergedEvent: { emit: vi.fn(async () => undefined) },
		},
	} as unknown as PrCommandOptions;

	return { runtime: currentRuntime, context, session };
}

describe("merge protocol command", () => {
	it("registers only /merge and does not intercept normal input", () => {
		const commands = new Map<string, unknown>();
		const handlers = new Map<string, unknown>();
		const pi = {
			on: (event: string, handler: unknown) => handlers.set(event, handler),
			registerCommand: (name: string, command: unknown) =>
				commands.set(name, command),
		} as unknown as ExtensionAPI;
		const { runtime: currentRuntime } = runtimeForTest();

		registerMergeProtocol(pi, currentRuntime);

		expect([...commands.keys()]).toEqual(["merge"]);
		expect(handlers.has("input")).toBe(false);
		expect(handlers.has("resources_discover")).toBe(true);
	});

	it("confirms and executes the pinned PR before emitting a merge event", async () => {
		const exec = vi.fn(
			async (): Promise<CommandResult> => ({
				stdout: "merged",
				stderr: "",
				code: 0,
			}),
		);
		const { runtime: currentRuntime, context } = createRuntime(exec);
		const commands = new Map<
			string,
			{ handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
		>();
		const pi = {
			registerCommand: (
				name: string,
				command: {
					handler: (
						args: string,
						ctx: ExtensionCommandContext,
					) => Promise<void>;
				},
			) => commands.set(name, command),
			on: vi.fn(),
		} as unknown as ExtensionAPI;
		registerMergeProtocol(pi, currentRuntime);

		await commands.get("merge")?.handler("", context);

		expect(context.ui.confirm).toHaveBeenCalledWith(
			`Merge PR ${PR_URL}?`,
			"Confirm merge of pinned pull request.",
		);
		expect(exec).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", PR_URL, "--merge"],
			{ cwd },
		);
		expect(
			currentRuntime.eventHandler.prMergedEvent.emit,
		).toHaveBeenCalledOnce();
		const emit = currentRuntime.eventHandler.prMergedEvent.emit as unknown as {
			mock: {
				calls: Array<
					[
						{
							prUrl: string;
							taskMarkedAsCompleted: boolean;
							sessionId: string;
							lifecycleEpoch: number;
						},
					]
				>;
			};
		};
		expect(emit.mock.calls[0]?.[0]).toEqual({
			prUrl: PR_URL,
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
	});

	it("does not merge when confirmation is declined", async () => {
		const exec = vi.fn();
		const { runtime, context } = createRuntime(exec, false);
		await (await commandFor(runtime)).handler("", context);
		expect(exec).not.toHaveBeenCalled();
		expect(runtime.eventHandler.prMergedEvent.emit).not.toHaveBeenCalled();
	});

	it("reports command failures without emitting an event", async () => {
		const exec = vi.fn(
			async (): Promise<CommandResult> => ({
				stdout: "",
				stderr: "permission denied\nextra output",
				code: 1,
			}),
		);
		const { runtime, context } = createRuntime(exec);
		await (await commandFor(runtime)).handler("", context);
		expect(runtime.eventHandler.prMergedEvent.emit).not.toHaveBeenCalled();
		expect(context.ui.notify).toHaveBeenCalledWith(
			"Pull request merge failed: permission denied extra output",
			"warning",
		);
	});

	it("does not run without a pinned PR or interactive UI", async () => {
		const exec = vi.fn();
		const { runtime, context } = createRuntime(exec);
		const session = runtime.getSession?.();
		if (session) session.state.prUrl = undefined;
		await (await commandFor(runtime)).handler("", context);
		expect(exec).not.toHaveBeenCalled();
		context.hasUI = false;
		const restoredSession = runtime.getSession?.();
		if (restoredSession) restoredSession.state.prUrl = PR_URL;
		await (await commandFor(runtime)).handler("", context);
		expect(exec).not.toHaveBeenCalled();
	});

	it("reports executor rejection without emitting an event", async () => {
		const exec = vi.fn(async () => {
			throw new Error("gh unavailable");
		});
		const { runtime, context } = createRuntime(exec);
		await (await commandFor(runtime)).handler("", context);
		expect(runtime.eventHandler.prMergedEvent.emit).not.toHaveBeenCalled();
		expect(context.ui.notify).toHaveBeenCalledWith(
			"Pull request merge failed: gh unavailable",
			"warning",
		);
	});
});

describe("merge protocol skill", () => {
	it("declares the safe merge workflow", async () => {
		const skill = await readFile(`${mergeProtocolSkillPath}/SKILL.md`, "utf8");
		expect(skill).toContain("name: merge-protocol");
		expect(skill).toContain(
			"description: Guides safe, user-confirmed pull request merging",
		);
		expect(skill).toContain("gh pr merge <url> --merge");
		expect(skill).toContain("Do not complete Todoist directly");
		expect(skill).toContain("pinned PR URL");
		expect(skill).toContain("explicit confirmation");
		expect(skill).toContain("prMerged");
	});

	it("packages the skill without an input pattern trigger", async () => {
		const packageManifest = JSON.parse(
			await readFile("package.json", "utf8"),
		) as { pi?: { skills?: string[] } };
		expect(packageManifest.pi?.skills).toBeUndefined();

		const extension = await readFile("src/pr/event-consumers.ts", "utf8");
		expect(extension).not.toContain('pi.on("input"');
		expect(extension).not.toContain("shouldTriggerMergeProtocol");
	});
});

function runtimeForTest() {
	return createRuntime(async () => ({ stdout: "", stderr: "", code: 0 }));
}

async function commandFor(runtime: PrCommandOptions) {
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
	>();
	const pi = {
		registerCommand: (
			name: string,
			command: {
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
			},
		) => commands.set(name, command),
		on: vi.fn(),
	} as unknown as ExtensionAPI;
	registerMergeProtocol(pi, runtime);
	return commands.get("merge") as {
		handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	};
}
