import { describe, expect, it } from "vitest";
import { PromptQueue } from "../src/prompt-queue.ts";

describe("PromptQueue", () => {
	it("runs prompts in enqueue order", async () => {
		const queue = new PromptQueue();
		const order: string[] = [];

		const first = queue.enqueue(async () => {
			order.push("first-start");
			await Promise.resolve();
			order.push("first-end");
		});
		const second = queue.enqueue(async () => {
			order.push("second");
		});

		await Promise.all([first, second]);

		expect(order).toEqual(["first-start", "first-end", "second"]);
	});

	it("drops queued prompts when reset", async () => {
		const queue = new PromptQueue();
		let releaseFirst!: () => void;
		const firstReleased = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const calls: string[] = [];

		const first = queue.enqueue(async () => {
			calls.push("first");
			await firstReleased;
		});
		const second = queue.enqueue(async () => {
			calls.push("second");
		});

		await Promise.resolve();
		expect(calls).toEqual(["first"]);
		queue.reset();
		releaseFirst();
		await Promise.all([first, second]);

		expect(calls).toEqual(["first"]);
	});

	it("returns undefined for stale task and runs current task after reset", async () => {
		const queue = new PromptQueue();
		let releaseFirst!: () => void;
		const firstReleased = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const calls: string[] = [];

		const first = queue.enqueue(async () => {
			calls.push("first");
			await firstReleased;
			return "first-result";
		});
		const stale = queue.enqueue(() => {
			calls.push("stale");
			return "stale-result";
		});

		await Promise.resolve();
		queue.reset();
		const current = queue.enqueue(() => {
			calls.push("current");
			return "current-result";
		});
		releaseFirst();

		expect(await first).toBe("first-result");
		expect(await stale).toBeUndefined();
		expect(await current).toBe("current-result");
		expect(calls).toEqual(["first", "current"]);
	});

	it("lets visible prompts suppress stale completion after reset", async () => {
		const queue = new PromptQueue();
		let releasePrompt!: () => void;
		const promptReleased = new Promise<void>((resolve) => {
			releasePrompt = resolve;
		});
		const completed: string[] = [];

		const prompt = queue.enqueue(async (isCurrent) => {
			await promptReleased;
			if (!isCurrent()) return;
			completed.push("stale prompt");
		});

		await Promise.resolve();
		queue.reset();
		releasePrompt();
		await prompt;

		expect(completed).toEqual([]);
	});
});
