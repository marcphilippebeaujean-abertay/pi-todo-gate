import { describe, expect, it, vi } from "vitest";
import { handleSessionShutdown } from "../src/application/session.ts";
import type { ExtensionRuntime } from "../src/state.ts";

describe("session shutdown", () => {
	it("does not emit delayed shutdown work", () => {
		const events = {
			emit: vi.fn(),
		};
		const runtime = {
			events,
			active: null,
			promptQueue: { reset: vi.fn() },
			taskClaim: { pending: false, completed: false, session: undefined },
			footer: { deactivate: vi.fn() },
			worktree: { deactivate: vi.fn() },
			exitProtocol: { deactivate: vi.fn() },
		} as unknown as ExtensionRuntime;

		handleSessionShutdown(runtime);

		expect(events.emit).not.toHaveBeenCalled();
		expect(runtime.footer.deactivate).toHaveBeenCalledOnce();
		expect(runtime.worktree.deactivate).toHaveBeenCalledOnce();
		expect(runtime.exitProtocol.deactivate).toHaveBeenCalledOnce();
	});
});
