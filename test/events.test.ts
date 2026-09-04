import { describe, expect, it } from "vitest";
import type { ExitAction } from "../src/exit-protocol/types.ts";
import { createSharedEvents } from "../src/shared/events.ts";

const action = (
	id: ExitAction["id"] = "complete-todoist-task",
): ExitAction => ({
	id,
	label: id,
	execute: async () => "completed",
});

describe("shared events", () => {
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

		await events.emit("prMerged", { prUrl: "pr" });

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

		await events.emit("prMerged", { prUrl: "pr" });

		expect(order).toEqual(["failed", "continued", "present:1"]);
	});

	it("unsubscribes listeners and isolates separate emits", async () => {
		const events = createSharedEvents();
		let calls = 0;
		const unsubscribe = events.on("prMerged", (request) => {
			calls += 1;
			request.addAction(action());
		});

		await events.emit("prMerged", { prUrl: "one" });
		unsubscribe();
		await events.emit("prMerged", { prUrl: "two" });

		expect(calls).toBe(1);
	});
});
