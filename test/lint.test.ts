const SRC_EXAMPLE_TS_4_7_FUNCTION_LENGTH =
	"src/example.ts:4:7 function-length Function exceeds maximum length (51; 50)";
const RETURNS_NO_DIAGNOSTICS_FOR_A_CLEAN_PROGRAM =
	"returns no diagnostics for a clean program";
const EXPORT_CONST_ANSWER_42 = "export const answer = 42;\n";

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	formatLintDiagnostic,
	type LintDiagnostic,
	lintProgram,
} from "../src/lint.ts";

const TEMP_PREFIX = "pi-todo-gate-lint-";
const FIXTURE_NAME = "fixture.ts";
const DIAGNOSTIC_TEST =
	"formats diagnostics with stable location and threshold";
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
const TYPE_SYNTAX_SOURCE = `function read(): "ok" {
	return "ok";
}`;
const DIRECTIVE_SOURCE = `function read() {
	"use strict";
	return true;
}`;
const STANDALONE_STRING_SOURCE = `function read() {
	"use strict";
	void 0;
	"not a directive";
	return true;
}`;
const TWO_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean) { return a && b; }";
const THREE_CHECKS_SOURCE =
	"function check(a: boolean, b: boolean, c: boolean) { return a && (b || c); }";
const MAGIC_TEST =
	"flags executable string literals but permits const definitions";
const EXPRESSION_TEST = "flags three logical checks but permits two";
const NO_MAGIC_RULE = "no-magic-strings";
const NO_EXPRESSION_RULE = "no-complicated-expressions";
const NAMED_IF_RULE = "named-if-condition";
const NAMED_IF_TEST = "requires named boolean conditions";
const IF_SOURCE = `function check(accountBalance: number, isClosed: boolean, count: number) {
	if (accountBalance > 0) return true;
	if (isClosed) return false;
	if (!isClosed) return false;
	if (count) return true;
	return false;
}`;
const METRIC_TEST = "reports function metrics over configured limits";
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
const METRIC_RULES = [
	"cyclomatic-complexity",
	"function-length",
	"functions-per-file",
	"nested-function-depth",
];

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
			SRC_EXAMPLE_TS_4_7_FUNCTION_LENGTH,
		);
	});

	it(RETURNS_NO_DIAGNOSTICS_FOR_A_CLEAN_PROGRAM, async () => {
		const program = await fixtureProgram(EXPORT_CONST_ANSWER_42);
		expect(lintProgram(program)).toEqual([]);
	});

	it(MAGIC_TEST, async () => {
		expect(ruleIds(await lintFixture(MAGIC_SOURCE))).toContain(NO_MAGIC_RULE);
		expect(ruleIds(await lintFixture(CONSTANT_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(ruleIds(await lintFixture(MODULE_PROPERTY_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(
			ruleIds(await lintFixture(TYPE_SYNTAX_SOURCE)).filter(
				(id) => id === NO_MAGIC_RULE,
			),
		).toHaveLength(1);
		expect(ruleIds(await lintFixture(DIRECTIVE_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(ruleIds(await lintFixture(STANDALONE_STRING_SOURCE))).toContain(
			NO_MAGIC_RULE,
		);
	});

	it(EXPRESSION_TEST, async () => {
		expect(ruleIds(await lintFixture(THREE_CHECKS_SOURCE))).toContain(
			NO_EXPRESSION_RULE,
		);
		expect(ruleIds(await lintFixture(TWO_CHECKS_SOURCE))).not.toContain(
			NO_EXPRESSION_RULE,
		);
	});

	it(NAMED_IF_TEST, async () => {
		const diagnostics = await lintFixture(IF_SOURCE);
		expect(
			ruleIds(diagnostics).filter((id) => id === NAMED_IF_RULE),
		).toHaveLength(2);
	});

	it(METRIC_TEST, async () => {
		const diagnostics = await lintFixture(
			`${COMPLEX_SOURCE}\n${NESTED_SOURCE}`,
			{
				maxCyclomaticComplexity: 1,
				maxFunctionLines: 1,
				maxFunctionsPerFile: 1,
				maxNestedFunctionDepth: 2,
			},
		);
		expect(ruleIds(diagnostics)).toEqual(expect.arrayContaining(METRIC_RULES));
	});
});
