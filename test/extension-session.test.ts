import { describe, expect, it, vi } from "vitest";
import { handleSessionShutdown } from "../src/event-consumer.ts";
import { RootEventPublisher } from "../src/event-publishers.ts";
import { type EventHandler, event } from "../src/shared/events.ts";

describe("session shutdown", () => {
	it("clears shared state and deactivates modules", () => {
		const eventHandler = {
			moduleStateChangedEvent: event(),
			sessionStateChangedEvent: event(),
			toolResultEvent: event(),
			sessionResetEvent: event(),
			sessionActivatedEvent: event(),
			sessionDeactivatedEvent: event(),
			prMergedEvent: event(),
			footerUpdateEvent: event(),
		} as unknown as EventHandler;
		const runtime = {
			eventHandler,
			publisher: new RootEventPublisher(eventHandler),
			promptQueue: { reset: vi.fn() },
			sessionState: {
				sessionId: "session",
				gitState: { branch: "main" },
				moduleState: { work: {} },
			},
			getSession: () => null,
			setSession: vi.fn(),
			pr: { deactivateSession: vi.fn() },
			footer: { deactivate: vi.fn() },
			worktree: { deactivate: vi.fn() },
			exitProtocol: { deactivate: vi.fn() },
		} as unknown as Parameters<typeof handleSessionShutdown>[0];

		handleSessionShutdown(runtime);

		expect(runtime.promptQueue.reset).toHaveBeenCalledOnce();
		expect(runtime.sessionState).toMatchObject({
			sessionId: null,
			gitState: {},
			moduleState: {},
		});
		expect(runtime.footer.deactivate).toHaveBeenCalledOnce();
		expect(runtime.worktree.deactivate).toHaveBeenCalledOnce();
		expect(runtime.exitProtocol.deactivate).toHaveBeenCalledOnce();
	});
});
