import { describe, expect, it } from "vitest";
import { createSharedEvents, event } from "../src/shared/events.ts";

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

	it("exposes one shared PR merge channel", () => {
		const events = createSharedEvents();
		expect(
			Object.keys(events).filter((key) => key === "prMergedEvent"),
		).toEqual(["prMergedEvent"]);
	});

	it("delivers merge payload to subscribers in registration order", async () => {
		const events = createSharedEvents();
		const order: string[] = [];
		events.prMergedEvent.subscribe(() => {
			order.push("first");
		});
		events.prMergedEvent.subscribe(() => {
			order.push("second");
		});

		await events.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
		});

		expect(order).toEqual(["first", "second"]);
	});
});
