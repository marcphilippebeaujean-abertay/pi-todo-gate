import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "../src/herdr-claim-gate.ts";
import {
	type ClaimWorkerRequest,
	installHerdrClaimGate,
	type StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";

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
) {
	return {
		cwd: "/repo",
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

function fakeWorker() {
	let request: ClaimWorkerRequest | undefined;
	let cancelled = false;
	const start: StartBackgroundWorker = vi.fn((nextRequest) => {
		request = nextRequest;
		return {
			cancel: () => {
				cancelled = true;
			},
		};
	});
	return {
		start,
		get request() {
			return request;
		},
		complete() {
			request?.onClaimComplete();
		},
		fail(message: string) {
			request?.onFailure(message);
		},
		wasCancelled() {
			return cancelled;
		},
	};
}

async function startGate(
	pi: FakePi,
	options: {
		subagent?: boolean;
		entries?: Array<{ type: string; data: unknown }>;
		worker?: ReturnType<typeof fakeWorker>;
	} = {},
) {
	const previousHerdr = process.env.HERDR_ENV;
	const previousSubagent = process.env.PI_SUBAGENT_CHILD;
	process.env.HERDR_ENV = "1";
	if (options.subagent) process.env.PI_SUBAGENT_CHILD = "1";
	else delete process.env.PI_SUBAGENT_CHILD;

	installHerdrClaimGate(pi as unknown as ExtensionAPI, {
		commandRunner,
		startBackgroundWorker: options.worker?.start,
	});
	const handler = pi.handlers.get("session_start")?.[0];
	expect(handler).toBeDefined();
	await handler?.(
		{ reason: "startup" },
		contextFor(pi, options.entries ?? pi.entries),
	);

	if (previousHerdr === undefined) delete process.env.HERDR_ENV;
	else process.env.HERDR_ENV = previousHerdr;
	if (previousSubagent === undefined) delete process.env.PI_SUBAGENT_CHILD;
	else process.env.PI_SUBAGENT_CHILD = previousSubagent;
}

async function emit(pi: FakePi, event: string, value: unknown, ctx: unknown) {
	const handlers = pi.handlers.get(event) ?? [];
	return Promise.all(handlers.map((handler) => handler(value, ctx)));
}

describe("Herdr claim gate activation", () => {
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
		expect(pi.contextMessages).toHaveLength(0);
	});

	it("notifies user on worker completion without informing main agent", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "Fix dialog editor" },
			contextFor(pi),
		);

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

	it("does not start worker or inject instructions for dispatched child", async () => {
		const pi = createFakePi();
		const worker = fakeWorker();
		await startGate(pi, { worker, subagent: true });
		const result = await emit(
			pi,
			"before_agent_start",
			{ prompt: "child work" },
			contextFor(pi),
		);

		expect(worker.start).not.toHaveBeenCalled();
		expect(result).toEqual([undefined]);
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
		await startGate(pi, { worker });
		await emit(
			pi,
			"before_agent_start",
			{ prompt: "claim tab" },
			contextFor(pi),
		);
		worker.complete();

		const toolCall = pi.handlers.get("tool_call")?.[0];
		expect(
			await toolCall?.({ toolName: "read", input: {} }, contextFor(pi)),
		).toBeUndefined();
		await emit(pi, "session_shutdown", {}, contextFor(pi));
		expect(worker.wasCancelled()).toBe(false);
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

	it("lifts gate after allowed tab rename", async () => {
		const pi = createFakePi();
		await startGate(pi);
		const toolCall = pi.handlers.get("tool_call")?.[0];
		await toolCall?.(
			{
				toolName: "bash",
				input: { command: "herdr tab rename w1:t1 dialog-editor" },
			},
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
