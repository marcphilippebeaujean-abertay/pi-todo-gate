import { describe, expect, it, vi } from "vitest";
import type { HerdrClient } from "../../src/shared/herdr-client.ts";
import {
	boundHerdrClient,
	currentPaneId,
	tabLabel,
} from "../../src/shared/herdr-client.ts";

describe("HerdrClient", () => {
	it("uses current cwd when invoking bound client", () => {
		const cwd = { current: "/first" };
		const calls: Array<{ cwd: string; command: string; args: string[] }> = [];
		const herdrClient: HerdrClient = boundHerdrClient(
			cwd,
			(currentCwd, command, args) => {
				calls.push({ cwd: currentCwd, command, args });
				return currentCwd;
			},
		);

		expect(herdrClient("herdr", ["tab", "get"])).toBe("/first");
		cwd.current = "/second";
		expect(herdrClient("herdr", ["pane", "get"])).toBe("/second");
		expect(calls).toEqual([
			{ cwd: "/first", command: "herdr", args: ["tab", "get"] },
			{ cwd: "/second", command: "herdr", args: ["pane", "get"] },
		]);
	});

	it("reads current tab label through Herdr client", () => {
		const previousTabId = process.env.HERDR_TAB_ID;
		process.env.HERDR_TAB_ID = "w1:t1";
		const herdrClient = vi.fn(() =>
			JSON.stringify({ result: { tab: { label: "Review" } } }),
		);

		try {
			expect(tabLabel(herdrClient)).toBe("Review");
			expect(herdrClient).toHaveBeenCalledWith("herdr", [
				"tab",
				"get",
				"w1:t1",
			]);
		} finally {
			if (previousTabId === undefined) delete process.env.HERDR_TAB_ID;
			else process.env.HERDR_TAB_ID = previousTabId;
		}
	});

	it("reads current pane ID from Herdr session environment", () => {
		const previousPaneId = process.env.HERDR_PANE_ID;
		process.env.HERDR_PANE_ID = "w1:p1";

		try {
			expect(currentPaneId()).toBe("w1:p1");
		} finally {
			if (previousPaneId === undefined) delete process.env.HERDR_PANE_ID;
			else process.env.HERDR_PANE_ID = previousPaneId;
		}
	});
});
