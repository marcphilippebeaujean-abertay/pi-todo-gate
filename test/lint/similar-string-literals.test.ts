import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE_ID = "similar-string-literals";
const SIMILAR_SOURCE = `function describeWalkers() {
	return ["Johnny walks the dog", "Tom walks the dog"];
}`;
const BELOW_THRESHOLD_SOURCE = `function compareStrings() {
	return ["${"a".repeat(100)}", "${"a".repeat(59)}${"b".repeat(41)}"];
}`;
const AT_THRESHOLD_SOURCE = `function compareStrings() {
	return ["${"a".repeat(20)}", "${"a".repeat(12)}${"b".repeat(8)}"];
}`;
const UNRELATED_SOURCE = `function describeThings() {
	return ["Johnny walks the dog", "The process completed successfully"];
}`;
const EXACT_DUPLICATE_SOURCE = `function describeWalkers() {
	return ["Johnny walks the dog", "Johnny walks the dog"];
}`;
const SHORT_SIMILAR_SOURCE = `function describeWalkers() {
	return ["Johnny dog", "Tom dog"];
}`;
const TOP_LEVEL_SOURCE = `const messages = {
	johnny: "Johnny walks the dog",
	tom: "Tom walks the dog",
};`;
const TYPE_ONLY_SOURCE = `function describeWalkers() {
	type Walkers = "Johnny walks the dog" | "Tom walks the dog";
	return true;
}`;

describe(RULE_ID, () => {
	it("flags singleton literals with highly similar text", async () => {
		expect(ruleIds(await lintFixture(SIMILAR_SOURCE))).toContain(RULE_ID);
		expect(ruleIds(await lintFixture(UNRELATED_SOURCE))).not.toContain(RULE_ID);
		expect(ruleIds(await lintFixture(EXACT_DUPLICATE_SOURCE))).not.toContain(
			RULE_ID,
		);
		expect(ruleIds(await lintFixture(SHORT_SIMILAR_SOURCE))).not.toContain(
			RULE_ID,
		);
		expect(ruleIds(await lintFixture(TOP_LEVEL_SOURCE))).not.toContain(RULE_ID);
		expect(ruleIds(await lintFixture(TYPE_ONLY_SOURCE))).not.toContain(RULE_ID);
	});

	it("does not flag similarity below threshold", async () => {
		expect(ruleIds(await lintFixture(BELOW_THRESHOLD_SOURCE))).not.toContain(
			RULE_ID,
		);
	});

	it("flags similarity at threshold", async () => {
		const diagnostics = (await lintFixture(AT_THRESHOLD_SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map(({ value }) => value)).toEqual([80, 80]);
	});
});
