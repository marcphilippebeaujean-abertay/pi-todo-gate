import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE = "repeated-field-checks";
describe(RULE, () => {
	it("flags repeated field checks and ignores unrelated reads", async () => {
		expect(
			ruleIds(
				await lintFixture(
					`function stateOf(row: { state: string }) { const isMerged = row.state === "MERGED"; const isOpen = row.state === "OPEN"; return isMerged || isOpen; }`,
				),
			),
		).toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function stateOf(row: { state: string; status: string }) { const isMerged = row.state === "MERGED"; const isOpen = row.status === "OPEN"; return isMerged || isOpen; }`,
				),
			),
		).not.toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function stateOf(row: { state: string }) { return row.state + row.state; }`,
				),
			),
		).not.toContain(RULE);
	});
});
