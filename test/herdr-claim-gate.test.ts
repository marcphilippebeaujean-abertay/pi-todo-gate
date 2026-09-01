import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "../src/herdr-claim-gate.ts";
import {
	type ClaimWorkerRequest,
	installHerdrClaimGate,
	type StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";
import { allowedCommand } from "../src/herdr-claim-gate-commands.ts";
import { boundCommandRunner } from "../src/herdr-claim-gate-environment.ts";
import type { WorkerSpawner } from "../src/herdr-claim-worker.ts";

interface FakePi {
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	entries: Array<{ type: string; data?: unknown; customType?: string }>;
	notifications: Array<{ message: string; level: string }>;
	sentMessages: unknown[];
	contextMessages: unknown[];
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
	appendEntry(type: string, data: unknown): void;
}

function createFakePi(): FakePi {
	const entries: Array<{ type: string; data?: unknown; customType?: string }> =
		[];
	const pi: FakePi = {
		handlers: new Map(),
		entries,
		notifications: [],
		sentMessages: [],
		contextMessages: [],
		on(event, handler) {
			const handlers = this.handlers.get(event) ?? [];
			handlers.push(handler);
			this.handlers.set(event, handlers);
		},
		appendEntry(type, data) {
			entries.push({ type, data });
		},
	};
	return pi;
}

function contextFor(
	pi: FakePi,
	entries: Array<{
		type: string;
		data?: unknown;
		customType?: string;
	}> = pi.entries,
	cwd = "/repo",
) {
	return {
		cwd,
		mode: "tui",
		ui: {
			notify(message: string, level: string) {
				pi.notifications.push({ message, level });
			},
		},
		sessionManager: {
			getEntries: () => entries,
		},
	};
}

const commandRunner: CommandRunner = (command, args) => {
	if (command === "git" && args.join(" ") === "rev-parse --git-dir")
		return "/repo/.git\n";
	if (command === "git" && args.join(" ") === "rev-parse --git-common-dir")
		return "/repo/.git\n";
	return "{}";
};

function validatedRunner(label: () => string): CommandRunner {
	return (command, args) => {
		if (command === "herdr" && args.join(" ") === "tab get w1:t1")
			return JSON.stringify({ result: { tab: { label: label() } } });
		if (command === "herdr" && args.join(" ") === "pane get w1:p1")
			return JSON.stringify({ result: { pane: { tab_id: "w1:t1" } } });
		return commandRunner(command, args);
	};
}

function fakeWorker() {
	const requests: ClaimWorkerRequest[] = [];
	const cancelled: boolean[] = [];
	const start: StartBackgroundWorker = vi.fn((request) => {
		requests.push(request);
		cancelled.push(false);
		const index = requests.length - 1;
		return {
			cancel: () => {
				cancelled[index] = true;
			},
		};
	});
	return {
		start,
		get request() {
			return requests.at(-1);
		},
		complete(
			index = requests.length - 1,
			result?: Parameters<ClaimWorkerRequest["onClaimComplete"]>[0],
		) {
			requests[index]?.onClaimComplete(result);
		},
		fail(message: string, index = requests.length - 1) {
			requests[index]?.onFailure(message);
		},
		wasCancelled(index = 0) {
			return cancelled[index];
		},
	};
}

async function startGate(
	pi: FakePi,
	options: {
		entries?: Array<{ type: string; data: unknown }>;
		worker?: ReturnType<typeof fakeWorker>;
		commandRunner?: CommandRunner;
		startBackgroundWorker?: StartBackgroundWorker;
		shouldActivate?: () => boolean;
		cwd?: string;
		spawnWorker?: WorkerSpawner;
	} = {},
) {
	const previousHerdr = process.env.HERDR_ENV;
	const previousTab = process.env.HERDR_TAB_ID;
	const previousPane = process.env.HERDR_PANE_ID;
	process.env.HERDR_ENV = "1";
	process.env.HERDR_TAB_ID = "w1:t1";
	process.env.HERDR_PANE_ID = "w1:p1";

	installHerdrClaimGate(pi as unknown as ExtensionAPI, {
		commandRunner: options.commandRunner ?? commandRunner,
		startBackgroundWorker:
			options.startBackgroundWorker ?? options.worker?.start,
		shouldActivate: options.shouldActivate,
		spawnWorker: options.spawnWorker,
	});
	const handler = pi.handlers.get("session_start")?.[0];
	expect(handler).toBeDefined();
	await handler?.(
		{ reason: "startup" },
		contextFor(pi, options.entries ?? pi.entries, options.cwd),
	);

	if (previousHerdr === undefined) delete process.env.HERDR_ENV;
	else process.env.HERDR_ENV = previousHerdr;
	if (previousTab === undefined) delete process.env.HERDR_TAB_ID;
	else process.env.HERDR_TAB_ID = previousTab;
	if (previousPane === undefined) delete process.env.HERDR_PANE_ID;
	else process.env.HERDR_PANE_ID = previousPane;
}

async function emit(pi: FakePi, event: string, value: unknown, ctx: unknown) {
	const handlers = pi.handlers.get(event) ?? [];
	return Promise.all(handlers.map((handler) => handler(value, ctx)));
}

describe("Herdr command runner", () => {
	it("uses current cwd when session cwd changes", () => {
		let cwd = "/initial";
		const observed: string[] = [];
		const runner = boundCommandRunner(
			() => cwd,
			(currentCwd, command) => {
				observed.push(`${currentCwd}:${command}`);
				return "";
			},
		);

		runner("git", []);
		cwd = "/switched";
		runner("git", []);

		expect(observed).toEqual(["/initial:git", "/switched:git"]);
	});
});

describe("Herdr claim gate activation", () => {
	it("stays inactive when extension activation is disabled", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker, shouldActivate: () => false });

		const result = await emit(
			pi,
			"before_agent_start",
			{ prompt: "Fix dialog editor" },
			contextFor(pi),
		);

		expect(result).toEqual([undefined]);
		expect(worker.request).toBeUndefined();
	});

	it("starts worker with current prompt but returns no main-session message", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker });

		const result = await emit(
			pi,
			"before_agent_start",
			{ prompt: "Fix dialog editor" },
			contextFor(pi),
		);

		expect(result).toEqual([undefined]);
		expect(worker.request?.prompt).toBe("Fix dialog editor");
		expect(worker.request?.instructions).toContain("# STEP 0 — Setup Herdr");
		expect(worker.request?.instructions.toLowerCase()).not.toContain(
			"subagent",
		);
		expect(pi.contextMessages).toHaveLength(0);
	});

	it("notifies user on worker completion without informing main agent", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		let label = "probe";
		await startGate(pi, {
			worker,
			commandRunner: validatedRunner(() => label),
		});
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "Fix dialog editor" },
			contextFor(pi),
		);

		label = "dialog-editor";
		worker.complete();

		expect(pi.notifications.at(-1)).toEqual(
			expect.objectContaining({
				message: expect.stringContaining("Herdr"),
				level: "info",
			}),
		);
		expect(pi.sentMessages).toHaveLength(0);
		expect(pi.contextMessages).toHaveLength(0);
		expect(pi.entries).toHaveLength(1);
		expect(pi.entries[0].type).toBe("herdr-claim-gate");
	});

	it("accepts unchanged descriptive label with matching claim evidence", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, {
			worker,
			commandRunner: validatedRunner(() => "dialog-editor"),
		});
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "claim tab" },
			contextFor(pi),
		);
		worker.complete(undefined, { tabId: "w1:t1", label: "dialog-editor" });

		expect(pi.entries).toHaveLength(1);
		expect(pi.notifications.at(-1)?.level).toBe("info");
	});

	it("recognizes a persisted claim marker on resume", async () => {
		const pi = createFakePi();
		const entries = [
			{ type: "custom", customType: "herdr-claim-gate", data: { at: 1 } },
		];
		const worker = fakeWorker();
		await startGate(pi, { worker, entries });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "continue" },
			contextFor(pi, entries),
		);

		expect(worker.start).not.toHaveBeenCalled();
	});
});

describe("Herdr claim gate enforcement", () => {
	it("rejects raw newlines before shell execution", () => {
		expect(allowedCommand("herdr pane current\nrm -rf /\n")).toBe(false);
		expect(allowedCommand("\nherdr pane current")).toBe(false);
		expect(allowedCommand("herdr pane current\n")).toBe(false);
	});

	it("rejects labels with shell glob characters", () => {
		expect(
			allowedCommand("herdr pane move w1:p1 --new-tab --label * --focus"),
		).toBe(false);
	});

	it("blocks non-bash and non-allow-listed bash calls", async () => {
		const pi = createFakePi();
		await startGate(pi);
		const toolCall = pi.handlers.get("tool_call")?.[0];
		expect(toolCall).toBeDefined();

		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toEqual({
			block: true,
			reason: expect.stringContaining("Herdr instructions"),
		});
		expect(
			await toolCall?.(
				{ toolName: "bash", input: { command: "git status" } },
				contextFor(pi),
			),
		).toEqual({ block: true, reason: expect.stringContaining("Herdr") });
		expect(
			await toolCall?.(
				{
					toolName: "bash",
					input: { command: "herdr pane list --workspace $HERDR_WORKSPACE_ID" },
				},
				contextFor(pi),
			),
		).toBeUndefined();
		expect(
			await toolCall?.(
				{
					toolName: "bash",
					input: { command: "echo $HERDR_ENV && git status" },
				},
				contextFor(pi),
			),
		).toEqual({ block: true, reason: expect.stringContaining("Herdr") });
	});

	it("lifts gate when worker completes and cancels worker on shutdown", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		let label = "probe";
		await startGate(pi, {
			worker,
			commandRunner: validatedRunner(() => label),
		});
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "claim tab" },
			contextFor(pi),
		);
		label = "dialog-editor";
		worker.complete();

		const toolCall = pi.handlers.get("tool_call")?.[0];
		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toBeUndefined();
		await emit(pi, "session_shutdown", {}, contextFor(pi));
		expect(worker.wasCancelled()).toBe(false);
	});

	it("keeps gate active when worker exits cleanly without tab mutation", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, {
			worker,
			commandRunner: validatedRunner(() => "probe"),
		});
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "claim tab" },
			contextFor(pi),
		);
		worker.complete();

		expect(pi.entries).toHaveLength(0);
		expect(pi.notifications.at(-1)).toEqual(
			expect.objectContaining({
				message: expect.stringContaining("could not validate"),
				level: "warning",
			}),
		);
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "retry claim" },
			contextFor(pi),
		);
		expect(worker.start).toHaveBeenCalledTimes(2);
	});

	it("keeps gate active after worker failure and notifies user", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "claim tab" },
			contextFor(pi),
		);
		worker.fail("worker unavailable");

		const toolCall = pi.handlers.get("tool_call")?.[0];
		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toEqual({ block: true, reason: expect.stringContaining("Herdr") });
		expect(pi.notifications.at(-1)?.level).toBe("warning");
	});

	it("reports synchronous worker startup failures without rejecting the hook", async () => {
		const pi = createFakePi();
		await startGate(pi, {
			startBackgroundWorker: () => {
				throw new Error("worker unavailable");
			},
		});
		const handler = pi.handlers.get("before_agent_start")?.[0];
		expect(handler).toBeDefined();
		expect(() =>
			handler?.({ prompt: "claim tab" }, contextFor(pi)),
		).not.toThrow();
		expect(pi.notifications.at(-1)?.level).toBe("warning");
	});

	it("does not let stale worker completion affect a new session", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "old session" },
			contextFor(pi),
		);
		process.env.HERDR_ENV = "1";
		await emit(pi, "session_start", {}, contextFor(pi));
		expect(worker.wasCancelled()).toBe(true);
		worker.complete(0);
		expect(pi.entries).toHaveLength(0);
		delete process.env.HERDR_ENV;
	});

	it("starts default worker with session cwd", async () => {
		const pi = createFakePi();
		let workerCwd: string | undefined;
		const spawnWorker: WorkerSpawner = (_command, _args, options) => {
			workerCwd = options.cwd;
			return {
				stdout: { on: () => undefined },
				stderr: { on: () => undefined },
				on: () => undefined,
				kill: () => true,
			};
		};
		await startGate(pi, { spawnWorker, cwd: "/session/worktree" });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "session cwd" },
			contextFor(pi, pi.entries, "/session/worktree"),
		);

		expect(workerCwd).toBe("/session/worktree");
	});

	it("lifts gate only after successful allowed tab rename", async () => {
		const pi = createFakePi();
		await startGate(pi);
		const toolCall = pi.handlers.get("tool_call")?.[0];
		const toolResult = pi.handlers.get("tool_result")?.[0];
		const command = "herdr tab rename w1:t1 dialog-editor";
		await toolCall?.({ toolName: "bash", input: { command } }, contextFor(pi));
		await emit(
			pi,
			"tool_result",
			{ toolName: "bash", input: { command }, content: "", isError: true },
			contextFor(pi),
		);
		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toEqual({ block: true, reason: expect.stringContaining("Herdr") });

		await toolCall?.({ toolName: "bash", input: { command } }, contextFor(pi));
		await toolResult?.(
			{ toolName: "bash", input: { command }, content: "", isError: false },
			contextFor(pi),
		);
		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toBeUndefined();
	});
});

describe("Herdr automatic linked-worktree claim", () => {
	it("renames numeric default tab and skips worker instructions", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		const runner: CommandRunner = (command, args) => {
			if (command === "git" && args.join(" ") === "rev-parse --git-dir")
				return "/repo/.git/worktrees/feature\n";
			if (command === "git" && args.join(" ") === "rev-parse --git-common-dir")
				return "/repo/.git\n";
			if (command === "git" && args.join(" ") === "branch --show-current")
				return "feature/dialog-editor\n";
			if (command === "herdr" && args.join(" ") === "tab get w1:t1")
				return '{"result":{"tab":{"label":"7"}}}';
			return "{}";
		};
		const previousHerdr = process.env.HERDR_ENV;
		const previousSubagent = process.env.PI_SUBAGENT_CHILD;
		const previousTab = process.env.HERDR_TAB_ID;
		process.env.HERDR_ENV = "1";
		delete process.env.PI_SUBAGENT_CHILD;
		process.env.HERDR_TAB_ID = "w1:t1";
		try {
			installHerdrClaimGate(pi as unknown as ExtensionAPI, {
				commandRunner: runner,
				startBackgroundWorker: worker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.(
				{ reason: "startup" },
				contextFor(pi),
			);
		} finally {
			if (previousHerdr === undefined) delete process.env.HERDR_ENV;
			else process.env.HERDR_ENV = previousHerdr;
			if (previousSubagent === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previousSubagent;
			if (previousTab === undefined) delete process.env.HERDR_TAB_ID;
			else process.env.HERDR_TAB_ID = previousTab;
		}

		expect(pi.entries).toHaveLength(1);
		expect(worker.start).not.toHaveBeenCalled();
	});
});
