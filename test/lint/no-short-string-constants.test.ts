import { describe, expect, it } from "vitest";
import { lintFixture } from "./helpers.ts";

const RULE_ID = "no-short-string-constants";
const SOURCE = `function read() {
	const EMPTY = "";
	const LETTER = "x";
	return EMPTY + LETTER;
}`;

describe(RULE_ID, () => {
	it("rejects empty and one-character string constants", async () => {
		const diagnostics = (await lintFixture(SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map(({ value }) => value)).toEqual([0, 1]);
	});
});
