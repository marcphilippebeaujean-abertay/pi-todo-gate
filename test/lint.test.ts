import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	formatLintDiagnostic,
	lintProgram,
	type LintDiagnostic,
} from "../src/lint.ts";

const TEMP_PREFIX = "pi-todo-gate-lint-";
const FIXTURE_NAME = "fixture.ts";
const DIAGNOSTIC_TEST = "formats diagnostics with stable location and threshold";
const DIAGNOSTIC: LintDiagnostic = {
	filePath: "src/example.ts",
	line: 4,
	column: 7,
	ruleId: "function-length",
	message: "Function exceeds maximum length",
	value: 51,
	limit: 50,
};
const MAGIC_SOURCE = `function check(name: string) {
	return name === "Bob";
}`;
const CONSTANT_SOURCE = `function check(name: string) {
	const USER_NAME = "Bob";
	return name === USER_NAME;
}`;
const MODULE_PROPERTY_SOURCE = `import "side-effect";
const record = { message: "ok" };
export type Status = "ok";`;
const TWO_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean) { return a && b; }";
const THREE_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean, c: boolean) { return a && (b || c); }";
const MAGIC_TEST = "flags executable string literals but permits const definitions";
const EXPRESSION_TEST = "flags three logical checks but permits two";
const NO_MAGIC_RULE = "no-magic-strings";
const NO_EXPRESSION_RULE = "no-complicated-expressions";

function ruleIds(diagnostics: readonly LintDiagnostic[]): string[] {
	return diagnostics.map((diagnostic) => diagnostic.ruleId);
}

async function lintFixture(
	source: string,
	config: Partial<import("../src/lint-config.ts").LintConfig> = {},
): Promise<LintDiagnostic[]> {
	const program = await fixtureProgram(source);
	return lintProgram(program, config);
}

async function fixtureProgram(source: string): Promise<ts.Program> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const filePath = join(root, FIXTURE_NAME);
	await writeFile(filePath, source);
	return ts.createProgram([filePath], {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
	});
}

describe("lint diagnostics", () => {
	it(DIAGNOSTIC_TEST, () => {
		expect(formatLintDiagnostic(DIAGNOSTIC)).toBe(
			"src/example.ts:4:7 function-length Function exceeds maximum length (51; 50)",
		);
	});

	it("returns no diagnostics for a clean program", async () => {
		const program = await fixtureProgram("export const answer = 42;\n");
		expect(lintProgram(program)).toEqual([]);
	});

	it(MAGIC_TEST, async () => {
		expect(ruleIds(await lintFixture(MAGIC_SOURCE))).toContain(NO_MAGIC_RULE);
		expect(ruleIds(await lintFixture(CONSTANT_SOURCE))).not.toContain(NO_MAGIC_RULE);
		expect(ruleIds(await lintFixture(MODULE_PROPERTY_SOURCE))).not.toContain(NO_MAGIC_RULE);
	});

	it(EXPRESSION_TEST, async () => {
		expect(ruleIds(await lintFixture(THREE_CHECKS_SOURCE))).toContain(
			NO_EXPRESSION_RULE,
		);
		expect(ruleIds(await lintFixture(TWO_CHECKS_SOURCE))).not.toContain(
			NO_EXPRESSION_RULE,
		);
	});
});
