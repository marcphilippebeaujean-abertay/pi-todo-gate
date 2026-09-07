import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE = "no-magic-strings";
const MAGIC = `function check(name: string) { return name === "Bob"; }`;
const REPEATED = `function check(name: string) { return name === "Bob" || name === "Bob"; }`;
const CONSTANT = `function check(name: string) { const USER_NAME = "Bob"; return name === USER_NAME; }`;
const SPECIAL = `import "side-effect"; const record = { message: "ok" }; function check(value: { status: string }) { if (value.status === "ok") return value.status === "ok"; return false; } export type Status = "ok";`;
const DYNAMIC = `async function load() { return import("./module"); }`;
const TYPES = `function read(): "ok" { return "ok"; }`;
const TYPE_ONLY = `function read() { type Handler = (value: "ok") => "ok"; return true; }`;
const DIRECTIVE = `function read() { "use strict"; return true; }`;
const EMPTY = `function read() { return ""; }`;
const SHORT_CONSTANT = `function read() { const EMPTY = ""; const LETTER = "x"; return EMPTY + LETTER; }`;
const STANDALONE = `function read() { "use strict"; void 0; "not a directive"; return true; }`;
describe(RULE, () => {
	it("flags executable string literals but permits const definitions", async () => {
		expect(ruleIds(await lintFixture(MAGIC))).not.toContain(RULE);
		expect(
			ruleIds(await lintFixture(REPEATED)).filter((id) => id === RULE),
		).toHaveLength(2);
		expect(ruleIds(await lintFixture(CONSTANT))).not.toContain(RULE);
		expect(
			ruleIds(await lintFixture(SPECIAL)).filter((id) => id === RULE),
		).toHaveLength(2);
		expect(ruleIds(await lintFixture(DYNAMIC))).not.toContain(RULE);
		expect(ruleIds(await lintFixture(TYPES))).not.toContain(RULE);
		expect(ruleIds(await lintFixture(TYPE_ONLY))).not.toContain(RULE);
		expect(ruleIds(await lintFixture(DIRECTIVE))).not.toContain(RULE);
		expect(ruleIds(await lintFixture(EMPTY))).not.toContain(RULE);
		expect(
			ruleIds(await lintFixture(SHORT_CONSTANT)).filter((id) => id === RULE),
		).toHaveLength(0);
		expect(ruleIds(await lintFixture(STANDALONE))).not.toContain(RULE);
	}, 15_000);
});
