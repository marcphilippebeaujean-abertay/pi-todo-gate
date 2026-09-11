import { describe, expect, it } from "vitest";
import { lintFixture } from "./helpers.ts";

const RULE_ID = "no-default-parameters";
const SOURCE = `
function read(value = "value") {
	return value;
}

const write = (value: string = "value") => value;

class Reader {
	read(value = "value") {
		return value;
	}
}
`;
const CLEAN_SOURCE = `
function read(value?: string) {
	return value ?? "value";
}
`;

describe(RULE_ID, () => {
	it("reports every parameter initializer", async () => {
		const diagnostics = (await lintFixture(SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toHaveLength(3);
	});

	it("allows parameters without initializers", async () => {
		const diagnostics = (await lintFixture(CLEAN_SOURCE)).filter(
			({ ruleId }) => ruleId === RULE_ID,
		);
		expect(diagnostics).toEqual([]);
	});
});
