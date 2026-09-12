import { describe, expect, it, vi } from "vitest";
import { handleSessionShutdown } from "../src/application/session.ts";
import type { ExtensionState } from "../src/state.ts";

describe("session shutdown", () => {
	it("does not emit delayed shutdown work", () => {
		const events = {
			emit: vi.fn(),
		};
		const runtime = {
			eventHandler: events,
			promptQueue: { reset: vi.fn() },
			todoist: {
				taskClaim: { pending: false, completed: false, session: undefined },
			},
			footer: { deactivate: vi.fn() },
			worktree: { deactivate: vi.fn() },
			exitProtocol: { deactivate: vi.fn() },
			sessionState: { sessionId: null, moduleState: {} },
		} as unknown as ExtensionState;

		handleSessionShutdown(runtime);

		expect(events.emit).not.toHaveBeenCalled();
		expect(runtime.footer.deactivate).toHaveBeenCalledOnce();
		expect(runtime.worktree.deactivate).toHaveBeenCalledOnce();
		expect(runtime.exitProtocol.deactivate).toHaveBeenCalledOnce();
	});
});
