import { describe, expect, it, vi } from "vitest";
import type { ModuleStatePublisher } from "../../src/event-publishers.ts";
import { createModuleStatePublisher } from "../../src/event-publishers.ts";
import { executeStateTool } from "../../src/pr/state-tool.ts";
import { createEventHandler } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

const PR_URL = "https://github.com/o/r/pull/42";

describe("PR state tool", () => {
	it("reads remote origin and PR state from shared SessionState", async () => {
		const eventHandler = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const publisher = createModuleStatePublisher(
			eventHandler,
			"pr",
		) as ModuleStatePublisher<"pr">;
		const publish = vi.spyOn(publisher, "publish");
		await executeStateTool(
			{ sessionState, publisher },
			"tool-call",
			{ action: "set_pr", url: PR_URL },
			undefined,
			undefined,
			{ cwd: "/repo" } as never,
		);
		expect(publish).toHaveBeenCalledWith(
			expect.objectContaining({ prUrl: PR_URL, discoveryDisabled: false }),
			{ persist: true },
		);
	});
});
