import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE_ID = "named-if-condition";
const IF_SOURCE = `function check(accountBalance: number, isClosed: boolean, count: number) {
	if (accountBalance > 0) return true;
	if (isClosed) return false;
	if (!isClosed) return false;
	if (count) return true;
	return false;
}`;
const NON_BOOLEAN_IF_SOURCE = `function check(value: any, unknownValue: unknown, objectValue: { ready: boolean }) {
	if (value) return true;
	if (unknownValue) return true;
	if (objectValue) return true;
	return false;
}`;
const COMPUTED_IF_SOURCE = `function check(value: { status: string }, ready: { value: boolean }, enabled: boolean, isReady: () => boolean) {
	if (value.status === "ok") return true;
	if (ready.value) return true;
	if (isReady() && enabled) return true;
	return false;
}`;
const NEGATED_TYPE_GUARD_SOURCE = `function check(value: unknown, objectValue: object) {
	if (!(typeof value === "string")) return false;
	if (!("ready" in objectValue)) return false;
	if (!Array.isArray(value)) return false;
	return true;
}`;
const COMPUTED_CONTROL_FLOW_SOURCE = `function check(value: number, ready: boolean) {
	while (value > 0) value--;
	do value--; while (value > 0);
	for (; value > 0;) value--;
	return value > 0 ? value : Number(ready);
}`;
const FOR_ITERATION_SOURCE = `function check(values: number[]) {
	for (let index = 0; index < values.length; index += 1) values[index];
}`;

describe(RULE_ID, () => {
	it("requires named boolean conditions", async () => {
		expect(
			ruleIds(await lintFixture(IF_SOURCE)).filter((id) => id === RULE_ID),
		).toHaveLength(2);
		expect(
			ruleIds(await lintFixture(NON_BOOLEAN_IF_SOURCE)).filter(
				(id) => id === RULE_ID,
			),
		).toHaveLength(3);
		expect(
			ruleIds(await lintFixture(COMPUTED_IF_SOURCE)).filter(
				(id) => id === RULE_ID,
			),
		).toHaveLength(3);
		expect(
			ruleIds(await lintFixture(NEGATED_TYPE_GUARD_SOURCE)).filter(
				(id) => id === RULE_ID,
			),
		).toHaveLength(0);
	});

	it("requires named conditions across control-flow expressions", async () => {
		expect(
			ruleIds(await lintFixture(COMPUTED_CONTROL_FLOW_SOURCE)).filter(
				(id) => id === RULE_ID,
			),
		).toHaveLength(3);
	});

	it("does not require names for for-loop iteration clauses", async () => {
		expect(ruleIds(await lintFixture(FOR_ITERATION_SOURCE))).not.toContain(
			RULE_ID,
		);
	});
});
