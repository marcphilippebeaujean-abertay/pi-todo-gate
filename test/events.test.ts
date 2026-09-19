import { describe, expect, it, vi } from "vitest";
import { registerExtensionEventConsumers } from "../src/event-consumer.ts";
import {
	createModuleStatePublisher,
	RootEventPublisher,
} from "../src/event-publishers.ts";
import {
	createSharedEvents,
	event,
	withLoading,
} from "../src/shared/events.ts";
import { createSessionState } from "../src/state.ts";

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

	it("binds module publisher to its module ID", async () => {
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const publisher = createModuleStatePublisher(events, "pr");

		await publisher.publish(
			{
				prUrl: "https://github.com/o/r/pull/42",
				discoveryDisabled: false,
				discoveryTestedUrls: [],
				mergedPrs: [],
			},
			{ persist: true },
		);

		expect(updates).toEqual([
			{
				moduleId: "pr",
				moduleState: {
					prUrl: "https://github.com/o/r/pull/42",
					discoveryDisabled: false,
					discoveryTestedUrls: [],
					mergedPrs: [],
				},
				persist: true,
			},
		]);
	});

	it("publishes minimum PI registration context", async () => {
		const events = createSharedEvents();
		const publisher = new RootEventPublisher(events);
		const pi = {} as never;
		const payloads: unknown[] = [];
		events.piToolRegistrationsBecameAvailableEvent.subscribe((payload) => {
			payloads.push(payload);
		});

		await publisher.publishPiToolRegistrationsBecameAvailable({ pi });

		expect(payloads).toEqual([{ pi }]);
	});

	it("exposes generic action-loading channel without footer updates", () => {
		const events = createSharedEvents();
		expect(events).toHaveProperty("actionLoadingEvent");
		expect(events).not.toHaveProperty("footerUpdateEvent");
		expect(events).not.toHaveProperty("worktreeStatusEvent");
	});

	it("clears action loading after operation and completion callback", async () => {
		const events = createSharedEvents();
		const order: string[] = [];
		events.actionLoadingEvent.subscribe(({ isLoading }) => {
			order.push(isLoading ? "start" : "stop");
		});

		await withLoading(
			events,
			"todoist",
			async () => {
				order.push("operation");
			},
			async () => {
				order.push("complete");
			},
		);

		expect(order).toEqual(["start", "operation", "complete", "stop"]);
	});

	it("clears action loading when operation fails", async () => {
		const events = createSharedEvents();
		const loading: boolean[] = [];
		events.actionLoadingEvent.subscribe(({ isLoading }) => {
			loading.push(isLoading);
		});

		await expect(
			withLoading(events, "todoist", async () => {
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");

		expect(loading).toEqual([true, false]);
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
			sessionId: "session",
		});

		expect(order).toEqual(["first", "second"]);
	});

	it("routes notification to active session UI", async () => {
		const events = createSharedEvents();
		const activeNotify = vi.fn();
		const activeSession = {
			context: { ui: { notify: activeNotify } },
		} as never;
		const root = {
			pi: { on: vi.fn() },
			eventHandler: events,
			session: activeSession,
			sessionState: {
				...createSessionState(),
				session: { activeSessionId: "current" },
			},
		} as unknown as Parameters<typeof registerExtensionEventConsumers>[0];
		registerExtensionEventConsumers(root);

		await events.sessionNotificationEvent.emit({
			message: "Worktree cleanup skipped",
			level: "warning",
		});

		expect(activeNotify).toHaveBeenCalledWith(
			"Worktree cleanup skipped",
			"warning",
		);
	});

	it("queues notification until matching session activates", async () => {
		const events = createSharedEvents();
		const notify = vi.fn();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "next";
		const root = {
			pi: { on: vi.fn() },
			eventHandler: events,
			session: null,
			sessionState,
		} as unknown as Parameters<typeof registerExtensionEventConsumers>[0];
		registerExtensionEventConsumers(root);

		await events.sessionNotificationEvent.emit({
			message: "Todoist completion skipped",
			level: "warning",
		});
		const session = {
			context: { ui: { notify } },
		} as unknown as NonNullable<
			Parameters<typeof registerExtensionEventConsumers>[0]["session"]
		>;
		root.session = session;
		await events.sessionActivatedEvent.emit({
			context: session.context,
			sessionId: "next",
			session,
		});

		expect(notify).toHaveBeenCalledWith(
			"Todoist completion skipped",
			"warning",
		);
	});

	it("drops notification when no session is active", async () => {
		const events = createSharedEvents();
		const notify = vi.fn();
		const root = {
			pi: { on: vi.fn() },
			eventHandler: events,
			session: null,
			sessionState: createSessionState(),
		} as unknown as Parameters<typeof registerExtensionEventConsumers>[0];
		registerExtensionEventConsumers(root);

		await events.sessionNotificationEvent.emit({
			message: "discard",
			level: "info",
		});
		const laterSession = {
			context: { ui: { notify } },
		} as unknown as NonNullable<
			Parameters<typeof registerExtensionEventConsumers>[0]["session"]
		>;
		root.session = laterSession;
		await events.sessionActivatedEvent.emit({
			context: laterSession.context,
			sessionId: "later",
			session: laterSession,
		});

		expect(notify).not.toHaveBeenCalled();
	});
});
