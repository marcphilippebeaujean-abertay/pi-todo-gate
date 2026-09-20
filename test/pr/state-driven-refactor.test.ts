import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { createModuleStatePublisher } from "../../src/event-publishers.ts";
import { handlePrToolResult } from "../../src/pr/event-consumers.ts";
import { createPrModule } from "../../src/pr/module.ts";
import { executeStateTool } from "../../src/pr/state-tool.ts";
import type { Exec } from "../../src/shared/command.ts";
import { createEventHandler } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

const PR_42 = "https://github.com/o/r/pull/42";
const PR_43 = "https://github.com/o/r/pull/43";

function commandResult(stdout = "", code = 0) {
	return { stdout, stderr: "", code };
}

function stateToolDependencies() {
	const eventHandler = createEventHandler();
	const sessionState = createSessionState();
	sessionState.session.activeSessionId = "session";
	return {
		eventHandler,
		sessionState,
		dependencies: {
			sessionState,
			publisher: createModuleStatePublisher(eventHandler, "pr"),
		},
	};
}

describe("PR state-driven architecture", () => {
	it("removes callback bundles and runtime operation mirrors", async () => {
		const paths = [
			"src/pr/event-consumers.ts",
			"src/pr/internal-state.ts",
			"src/pr/module.ts",
			"src/pr/state-tool.ts",
		];
		const source = (
			await Promise.all(paths.map((path) => readFile(path, "utf8")))
		).join("\n");
		expect(source).not.toMatch(
			/Operations|operationDependencies|currentSession|getSession|updatePrState|syncPrState|PrSessionIdentity|OriginRequest|isCurrentMerge/,
		);
	});

	it("reads state tool inputs from shared SessionState", async () => {
		const { dependencies, sessionState } = stateToolDependencies();
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const published: unknown[] = [];
		dependencies.publisher.publish = vi.fn(async (state, options) => {
			published.push({ state, options });
		});

		await executeStateTool(
			dependencies,
			"tool-call",
			{ action: "set_pr", url: PR_42 },
			undefined,
			undefined,
			{ cwd: "/repo" } as never,
		);

		expect(published).toEqual([
			{
				state: expect.objectContaining({
					prUrl: PR_42,
					discoveryDisabled: false,
				}),
				options: { persist: true },
			},
		]);
	});

	it("accepts a valid PR discovery result after session transition", async () => {
		const eventHandler = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "old";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.gitState.worktreeRoot = "/repo";
		registerModuleStateConsumer(eventHandler, sessionState);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec: Exec = vi.fn(async (_command, args) => {
			if (args[0] === "pr") await blocked;
			return commandResult(JSON.stringify({ url: PR_42 }));
		});
		const module = createPrModule({
			eventHandler,
			sessionState,
			exec,
		}) as never as {
			persistPrIfAvailable(text: string): Promise<void>;
		};
		const discovery = module.persistPrIfAvailable(PR_42);
		await Promise.resolve();
		sessionState.session.activeSessionId = "new";
		release();
		await discovery;

		expect(sessionState.moduleState.pr.prUrl).toBe(PR_42);
	});

	it("lets last returned overlapping discovery result win", async () => {
		const eventHandler = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.gitState.worktreeRoot = "/repo";
		registerModuleStateConsumer(eventHandler, sessionState);
		let releaseFirst!: () => void;
		let releaseSecond!: () => void;
		let calls = 0;
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const second = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		const exec: Exec = vi.fn(async (_command, _args) => {
			calls += 1;
			const url = calls === 1 ? PR_42 : PR_43;
			if (calls === 1) await first;
			if (calls === 2) await second;
			return commandResult(JSON.stringify({ url }));
		});
		const module = createPrModule({
			eventHandler,
			sessionState,
			exec,
		}) as never as {
			persistPrIfAvailable(text: string): Promise<void>;
		};
		const firstDiscovery = module.persistPrIfAvailable(PR_42);
		const secondDiscovery = module.persistPrIfAvailable(PR_43);
		await Promise.resolve();
		releaseSecond();
		await secondDiscovery;
		releaseFirst();
		await firstDiscovery;

		expect(sessionState.moduleState.pr.prUrl).toBe(PR_42);
	});

	it("accepts a matching merge result after session transition", async () => {
		const eventHandler = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "old";
		sessionState.moduleState.pr.prUrl = PR_42;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec: Exec = vi.fn(async (_command, args) => {
			if (args[0] === "pr") await blocked;
			return commandResult(
				JSON.stringify({ url: PR_42, headRefName: "feature" }),
			);
		});
		const merged: string[] = [];
		eventHandler.prMergedEvent.subscribe(({ prUrl }) => {
			if (prUrl !== null) merged.push(prUrl);
		});
		const result = handlePrToolResult(
			sessionState,
			eventHandler,
			{
				toolName: "bash",
				isError: false,
				input: { command: "gh pr merge 42" },
			} as never,
			{ cwd: "/repo" } as never,
			exec,
		);
		await Promise.resolve();
		sessionState.session.activeSessionId = "new";
		release();
		await result;

		expect(merged).toEqual([PR_42]);
	});
});
