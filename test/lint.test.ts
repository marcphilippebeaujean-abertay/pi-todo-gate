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
function check(value: { status: string }) {
	if (value.status === "ok") return true;
	return false;
}
export type Status = "ok";`;
const DYNAMIC_IMPORT_SOURCE = `async function load() {
	return import("./module");
}`;
const TYPE_SYNTAX_SOURCE = `function read(): "ok" {
	return "ok";
}`;
const TYPE_ONLY_STRING_SOURCE = `function read() {
	type Handler = (value: "ok") => "ok";
	return true;
}`;
const DIRECTIVE_SOURCE = `function read() {
	"use strict";
	return true;
}`;
const EMPTY_STRING_SOURCE = `function read() {
	return "";
}`;
const SHORT_STRING_CONSTANT_SOURCE = `function read() {
	const EMPTY = "";
	const LETTER = "x";
	return EMPTY + LETTER;
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
	"function check(a: boolean, b: boolean, c: boolean) { if (a && b && c) return true; return false; }";
const MAGIC_TEST =
	"flags executable string literals but permits const definitions";
const EXPRESSION_TEST = "flags three logical checks but permits two";
const NO_MAGIC_RULE = "no-magic-strings";
const NO_SHORT_STRING_CONSTANTS_RULE = "no-short-string-constants";
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
const METRIC_TEST = "reports function metrics over configured limits";
const NORMALIZED_PATH_TEST = "sorts diagnostics by normalized path";
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
		expect(ruleIds(await lintFixture(MODULE_PROPERTY_SOURCE))).toContain(
			NO_MAGIC_RULE,
		);
		expect(ruleIds(await lintFixture(DYNAMIC_IMPORT_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(
			ruleIds(await lintFixture(TYPE_SYNTAX_SOURCE)).filter(
				(id) => id === NO_MAGIC_RULE,
			),
		).toHaveLength(1);
		expect(ruleIds(await lintFixture(TYPE_ONLY_STRING_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(ruleIds(await lintFixture(DIRECTIVE_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(ruleIds(await lintFixture(EMPTY_STRING_SOURCE))).not.toContain(
			NO_MAGIC_RULE,
		);
		expect(
			ruleIds(await lintFixture(SHORT_STRING_CONSTANT_SOURCE)).filter(
				(id) => id === NO_MAGIC_RULE,
			),
		).toHaveLength(0);
		expect(
			ruleIds(await lintFixture(SHORT_STRING_CONSTANT_SOURCE)).filter(
				(id) => id === NO_SHORT_STRING_CONSTANTS_RULE,
			),
		).toHaveLength(2);
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
		expect(
			ruleIds(await lintFixture(NON_BOOLEAN_IF_SOURCE)).filter(
				(id) => id === NAMED_IF_RULE,
			),
		).toHaveLength(3);
		expect(
			ruleIds(await lintFixture(COMPUTED_IF_SOURCE)).filter(
				(id) => id === NAMED_IF_RULE,
			),
		).toHaveLength(3);
		expect(
			ruleIds(await lintFixture(NEGATED_TYPE_GUARD_SOURCE)).filter(
				(id) => id === NAMED_IF_RULE,
			),
		).toHaveLength(0);
	});

	it(NORMALIZED_PATH_TEST, () => {
		const laterPath = ts.createSourceFile(
			"a/../b.ts",
			"function later() {}",
			ts.ScriptTarget.ES2022,
			true,
		);
		const earlierPath = ts.createSourceFile(
			"z/../a.ts",
			"function earlier() {}",
			ts.ScriptTarget.ES2022,
			true,
		);
		laterPath.fileName = "a/../b.ts";
		earlierPath.fileName = "z/../a.ts";
		const program = {
			getSourceFiles: () => [laterPath, earlierPath],
			getTypeChecker: () => ({}) as ts.TypeChecker,
		} as unknown as ts.Program;

		expect(
			lintProgram(program, { maxFunctionLines: 0 }).map(
				(diagnostic) => diagnostic.filePath,
			),
		).toEqual(["z/../a.ts", "a/../b.ts"]);
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
