import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE_ID = "no-complicated-expressions";
const TWO_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean) { return a && b; }";
const THREE_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean, c: boolean) { if (a && b && c) return true; return false; }";

describe(RULE_ID, () => {
	it("flags three logical checks but permits two", async () => {
		expect(ruleIds(await lintFixture(THREE_CHECKS_SOURCE))).toContain(RULE_ID);
		expect(ruleIds(await lintFixture(TWO_CHECKS_SOURCE))).not.toContain(
			RULE_ID,
		);
	});
});
