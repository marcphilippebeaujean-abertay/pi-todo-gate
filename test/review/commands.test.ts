import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../../src/review/commands.ts";
import type { ReviewCommandDependencies } from "../../src/review/internal-state.ts";
import { createSessionState } from "../../src/state.ts";

const cwd = "/repo";
const worktreePath = "/repo/.worktrees/feature";

function context(): ExtensionCommandContext {
	return {
		cwd,
		hasUI: true,
		ui: { notify: vi.fn() },
	} as unknown as ExtensionCommandContext;
}

function setup(agentStartFailures = 0): {
	dependencies: ReviewCommandDependencies;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	calls: Array<{ command: string; args: string[] }>;
	notify: ReturnType<typeof vi.fn>;
} {
	process.env.HERDR_PANE_ID = "w1:p1";
	const sessionState = createSessionState();
	sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/42";
	sessionState.gitState.worktreeRoot = worktreePath;
	const calls: Array<{ command: string; args: string[] }> = [];
	let remainingAgentStartFailures = agentStartFailures;
	const herdrClient = vi.fn((command: string, args: string[]) => {
		calls.push({ command, args });
		if (
			remainingAgentStartFailures > 0 &&
			args[0] === "agent" &&
			args[1] === "start"
		) {
			remainingAgentStartFailures -= 1;
			throw new Error("agent_not_ready");
		}
		if (args[0] === "pane" && args[1] === "split")
			return JSON.stringify({ result: { pane: { pane_id: "w1:p2" } } });
		return "{}";
	});
	const notify = vi.fn();
	const dependencies = {
		pi: undefined,
		sessionState,
		herdrClient,
	} as unknown as ReviewCommandDependencies;
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
	>();
	register(
		{
			registerCommand: (name: string, command: unknown) =>
				commands.set(name, command as never),
		} as unknown as ExtensionAPI,
		dependencies,
	);
	const handler = commands.get("tg_review")?.handler;
	if (handler === undefined) throw new Error("review command missing");
	return { dependencies, handler, calls, notify };
}

afterEach(() => {
	delete process.env.HERDR_PANE_ID;
});

describe("review command", () => {
	it("opens right-hand worktree pane and starts extension-free Pi reviewer", async () => {
		const fixture = setup();
		await fixture.handler("", context());

		expect(fixture.calls).toHaveLength(5);
		expect(fixture.calls.slice(0, 2)).toEqual([
			{
				command: "herdr",
				args: [
					"pane",
					"split",
					"w1:p1",
					"--direction",
					"right",
					"--cwd",
					worktreePath,
					"--focus",
				],
			},
			{
				command: "herdr",
				args: [
					"pane",
					"run",
					"w1:p2",
					"echo __PI_TODO_GATE_REVIEW_SHELL_READY__",
				],
			},
		]);
		expect(fixture.calls[2]).toEqual({
			command: "herdr",
			args: [
				"pane",
				"wait-output",
				"w1:p2",
				"--match",
				"__PI_TODO_GATE_REVIEW_SHELL_READY__",
				"--source",
				"recent-unwrapped",
				"--timeout",
				"30000",
			],
		});
		const startCall = fixture.calls[3];
		const agentName = startCall?.args[2];
		expect(agentName).toMatch(/^review-[0-9a-f]{8}$/);
		expect(startCall).toEqual({
			command: "herdr",
			args: [
				"agent",
				"start",
				agentName,
				"--kind",
				"pi",
				"--pane",
				"w1:p2",
				"--",
				"--no-extensions",
			],
		});
		expect(fixture.calls[4]).toEqual({
			command: "herdr",
			args: [
				"agent",
				"prompt",
				agentName,
				expect.stringContaining(
					"Review PR https://github.com/o/r/pull/42 code in /repo/.worktrees/feature",
				),
			],
		});
	});

	it("retries Pi after Herdr reports startup not ready", async () => {
		const fixture = setup(1);
		await fixture.handler("", context());

		const agentName = fixture.calls[3]?.args[2];
		expect(fixture.calls).toHaveLength(6);
		expect(fixture.calls[4]).toEqual({
			command: "herdr",
			args: [
				"agent",
				"start",
				agentName,
				"--kind",
				"pi",
				"--pane",
				"w1:p2",
				"--",
				"--no-extensions",
			],
		});
		expect(fixture.calls[5]).toEqual({
			command: "herdr",
			args: [
				"agent",
				"prompt",
				agentName,
				expect.stringContaining("Review PR"),
			],
		});
	});

	it("falls back to command context directory without a worktree", async () => {
		const fixture = setup();
		fixture.dependencies.sessionState.gitState.worktreeRoot = undefined;
		await fixture.handler("", context());

		expect(fixture.calls[0]?.args).toContain(cwd);
	});

	it("does not open pane when no PR is pinned", async () => {
		const fixture = setup();
		fixture.dependencies.sessionState.moduleState.pr.prUrl = undefined;
		await fixture.handler("", context());

		expect(fixture.calls).toEqual([]);
	});
});
