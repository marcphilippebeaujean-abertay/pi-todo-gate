import { describe, expect, it } from "vitest";
import { createSharedEvents } from "../src/shared/events.ts";
import type { ExitAction } from "../src/shared/exit-actions.ts";

const action = (id: ExitAction["id"] = "remove-worktree"): ExitAction => ({
	id,
	label: id,
	execute: async () => "completed",
});

describe("shared events", () => {
	it("shares mutable merge completion state between listeners", async () => {
		const events = createSharedEvents();
		let observed = false;
		events.on("prMerged", (request) => {
			request.payload.taskMarkedAsCompleted = true;
		});
		events.on("prMerged", (request) => {
			observed = request.payload.taskMarkedAsCompleted === true;
		});

		await events.emit("prMerged", {
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
		});

		expect(observed).toBe(true);
	});
	it("collects actions before present listeners run", async () => {
		const events = createSharedEvents();
		const order: string[] = [];

		events.on("prMerged", (request) => {
			order.push("todoist");
			request.addAction(action());
		});
		events.on(
			"prMerged",
			(request) => {
				order.push(`present:${request.actions.length}`);
			},
			"present",
		);

		await events.emit("prMerged", {
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
		});

		expect(order).toEqual(["todoist", "present:1"]);
	});

	it("awaits asynchronous listeners in registration order", async () => {
		const events = createSharedEvents();
		const order: string[] = [];

		events.on("prMerged", async () => {
			await Promise.resolve();
			order.push("first");
		});
		events.on("prMerged", () => {
			order.push("second");
		});

		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});

		expect(order).toEqual(["first", "second"]);
	});

	it("continues after a listener throws", async () => {
		const events = createSharedEvents();
		const order: string[] = [];

		events.on("prMerged", () => {
			order.push("failed");
			throw new Error("listener failed");
		});
		events.on("prMerged", (request) => {
			order.push("continued");
			request.addAction(action("remove-worktree"));
		});
		events.on(
			"prMerged",
			(request) => {
				order.push(`present:${request.actions.length}`);
			},
			"present",
		);

		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});

		expect(order).toEqual(["failed", "continued", "present:1"]);
	});

	it("allows merge events to clear pinned PR URL", async () => {
		const events = createSharedEvents();
		let observed: string | null | undefined;
		events.on("prMerged", (request) => {
			observed = request.payload.prUrl;
		});

		await events.emit("prMerged", {
			prUrl: null,
			taskMarkedAsCompleted: false,
		});

		expect(observed).toBeNull();
	});

	it("unsubscribes listeners and isolates separate emits", async () => {
		const events = createSharedEvents();
		let calls = 0;
		const unsubscribe = events.on("prMerged", (request) => {
			calls += 1;
			request.addAction(action());
		});

		await events.emit("prMerged", {
			prUrl: "one",
			taskMarkedAsCompleted: false,
		});
		unsubscribe();
		await events.emit("prMerged", {
			prUrl: "two",
			taskMarkedAsCompleted: false,
		});

		expect(calls).toBe(1);
	});
});
