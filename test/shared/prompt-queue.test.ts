import { describe, expect, it } from "vitest";
import { PromptQueue } from "../../src/shared/prompt-queue.ts";

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
