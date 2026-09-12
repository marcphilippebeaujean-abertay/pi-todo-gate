import { describe, expect, it } from "vitest";
import {
	createPrMergedRequest,
	createSharedEvents,
	event,
} from "../src/shared/events.ts";
import type { ExitAction } from "../src/shared/exit-actions.ts";

const action = (id: ExitAction["id"] = "remove-worktree"): ExitAction => ({
	id,
	label: id,
	execute: async () => "completed",
});

describe("shared events", () => {
	it("delivers typed payloads and supports unsubscribe", async () => {
		const channel = event<{ value: number }>();
		const values: number[] = [];
		const unsubscribe = channel.subscribe(({ value }) => {
			values.push(value);
		});
		await channel.emit({ value: 1 });
		unsubscribe();
		await channel.emit({ value: 2 });
		expect(values).toEqual([1]);
	});

	it("awaits asynchronous subscribers in registration order", async () => {
		const channel = event<string>();
		const order: string[] = [];
		channel.subscribe(async () => {
			await Promise.resolve();
			order.push("first");
		});
		channel.subscribe(() => {
			order.push("second");
		});

		await channel.emit("payload");

		expect(order).toEqual(["first", "second"]);
	});

	it("snapshots subscribers and isolates callback failures", async () => {
		const channel = event<void>();
		const order: string[] = [];
		let unsubscribeSecond = (): void => undefined;
		channel.subscribe(() => {
			order.push("first");
			unsubscribeSecond();
			throw new Error("listener failed");
		});
		unsubscribeSecond = channel.subscribe(() => {
			order.push("second");
		});
		channel.subscribe(() => {
			order.push("third");
		});

		await channel.emit(undefined);

		expect(order).toEqual(["first", "second", "third"]);
	});

	it("preserves merge action collection before later subscribers", async () => {
		const events = createSharedEvents();
		const order: string[] = [];
		events.prMergeRequestedEvent.subscribe((request) => {
			order.push("todoist");
			request.addAction(action());
		});
		events.prMergedEvent.subscribe((request) => {
			order.push(`present:${request.actions.length}`);
		});

		await events.prMergeRequestedEvent.emit(
			createPrMergedRequest({
				prUrl: "https://github.com/o/r/pull/1",
				taskMarkedAsCompleted: false,
			}),
		);

		expect(order).toEqual(["todoist", "present:1"]);
	});
});
