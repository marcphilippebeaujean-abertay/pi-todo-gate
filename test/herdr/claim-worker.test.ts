import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
	type ClaimWorkerRequest,
	createHerdrEvents,
	startClaimWorker,
	type WorkerProcess,
	type WorkerSpawner,
} from "../../src/herdr/module.ts";

class FakeProcess extends EventEmitter implements WorkerProcess {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = vi.fn(() => true);
}

function setup() {
	const process = new FakeProcess();
	let spawned:
		| {
				command: string;
				args: readonly string[];
				options: { cwd: string; env: NodeJS.ProcessEnv; shell: false };
		  }
		| undefined;
	const spawnWorker: WorkerSpawner = (command, args, options) => {
		spawned = { command, args, options };
		return process;
	};
	const events = createHerdrEvents();
	const completed = vi.fn();
	const failed = vi.fn();
	events.claimCompletedEvent.subscribe(completed);
	events.claimFailedEvent.subscribe(failed);
	const request: ClaimWorkerRequest = {
		prompt: "Fix dialog",
		instructions: "Claim tab",
		attemptId: 1,
		events,
	};
	return {
		process,
		spawnWorker,
		request,
		completed,
		failed,
		get spawned() {
			return spawned;
		},
	};
}

describe("startClaimWorker", () => {
	it("starts separate ephemeral Pi process with isolated worker prompt", () => {
		const setupState = setup();
		const handle = startClaimWorker(setupState.request, {
			spawnWorker: setupState.spawnWorker,
			cwd: "/repo/worktree",
		});

		expect(setupState.spawned?.command).toBe("pi");
		expect(setupState.spawned?.args).toEqual([
			"--mode",
			"json",
			"-p",
			"--no-extensions",
			"--no-context-files",
			"--tools",
			"bash",
			"--append-system-prompt",
			"Claim tab",
			"--thinking",
			"high",
			"Fix dialog",
		]);
		expect(setupState.spawned?.options.shell).toBe(false);
		expect(setupState.spawned?.options.cwd).toBe("/repo/worktree");
		expect(setupState.spawned?.options).toMatchObject({
			stdio: ["ignore", "pipe", "pipe"],
		});
		expect(setupState.spawned?.options.env.PI_SUBAGENT_CHILD).toBe("1");
		expect(setupState.spawned?.options.env.HERDR_ENV).toBe(
			process.env.HERDR_ENV,
		);
		expect(handle.cancel).toBeTypeOf("function");
	});

	it("emits completion without forwarding worker output", () => {
		const setupState = setup();
		startClaimWorker(setupState.request, {
			spawnWorker: setupState.spawnWorker,
		});

		setupState.process.stdout.write(
			`${JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: '{"status":"claimed","tabId":"w1:t1","label":"dialog-editor"}',
						},
					],
				},
			})}\n${JSON.stringify({ type: "turn_end" })}\n`,
		);
		setupState.process.stderr.write("private warning\n");
		setupState.process.emit("close", 0);

		expect(setupState.completed).toHaveBeenCalledWith({
			attemptId: 1,
			result: { tabId: "w1:t1", label: "dialog-editor" },
		});
		expect(setupState.failed).not.toHaveBeenCalled();
	});

	it("reports missing claim evidence on clean worker exit", () => {
		const setupState = setup();
		startClaimWorker(setupState.request, {
			spawnWorker: setupState.spawnWorker,
		});

		setupState.process.emit("close", 0);

		expect(setupState.completed).not.toHaveBeenCalled();
		expect(setupState.failed).toHaveBeenCalledWith({
			attemptId: 1,
			message: "completed without claim evidence",
			workerFailed: true,
		});
	});

	it("reports process failure once and cancels child with SIGTERM", () => {
		const setupState = setup();
		const handle = startClaimWorker(setupState.request, {
			spawnWorker: setupState.spawnWorker,
		});

		handle.cancel();
		expect(setupState.process.kill).toHaveBeenCalledWith("SIGTERM");
		setupState.process.emit("close", 1);
		setupState.process.emit("error", new Error("worker failed"));

		expect(setupState.failed).not.toHaveBeenCalled();

		const retry = setup();
		startClaimWorker(retry.request, { spawnWorker: retry.spawnWorker });
		retry.process.emit("error", new Error("worker failed"));
		retry.process.emit("close", 1);
		expect(retry.failed).toHaveBeenCalledOnce();
		expect(retry.failed).toHaveBeenCalledWith({
			attemptId: 1,
			message: expect.stringContaining("worker"),
			workerFailed: true,
		});
	});
});
