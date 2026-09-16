import { describe, expect, it } from "vitest";
import type { HerdrClient } from "../../src/herdr/internal-state.ts";
import { boundHerdrClient } from "../../src/herdr/runtime.ts";

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
});
