import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE_IDS = [
	"cyclomatic-complexity",
	"function-length",
	"functions-per-file",
	"nested-function-depth",
];
const COMPLEX_SOURCE = `function complex(value: number) {
	if (value > 0 && value < 10) {
		for (const item of [value]) {
			if (item) {
				try {
					return item;
				} catch {
					return 0;
				}
			}
		}
	}
	if (value === 1) return 1;
	if (value === 2) return 2;
	if (value === 3) return 3;
	if (value === 4) return 4;
	if (value === 5) return 5;
	return 0;
}`;
const NESTED_SOURCE = `function outer() {
	const one = () => {
		const two = () => {
			const three = () => true;
			return three();
		};
		return two();
	};
	return one();
}`;

describe("function metrics", () => {
	it("reports function metrics over configured limits", async () => {
		const diagnostics = await lintFixture(
			`${COMPLEX_SOURCE}\n${NESTED_SOURCE}`,
			{
				maxCyclomaticComplexity: 1,
				maxFunctionLines: 1,
				maxFunctionsPerFile: 1,
				maxNestedFunctionDepth: 2,
			},
		);
		expect(ruleIds(diagnostics)).toEqual(expect.arrayContaining(RULE_IDS));
	});
});
