import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
	formatLintDiagnostic,
	type LintDiagnostic,
	lintProgram,
} from "../../src/lint/index.ts";
import { lintFixture } from "./helpers.ts";

const FORMATTED_DIAGNOSTIC =
	"src/example.ts:4:7 function-length Function exceeds maximum length (51; 50)";
const DIAGNOSTIC: LintDiagnostic = {
	filePath: "src/example.ts",
	line: 4,
	column: 7,
	ruleId: "function-length",
	message: "Function exceeds maximum length",
	value: 51,
	limit: 50,
};
const SOURCE_DIRECTORY = resolve(import.meta.dirname, "../../src");
const TYPESCRIPT_EXTENSION = ".ts";
const CRYPTIC_LITERAL_CONSTANT_PATTERN = /^const STRING_LITERAL_/m;

function sourceFile(fileName: string, source: string): ts.SourceFile {
	return ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
}

describe("lint diagnostics", () => {
	it("formats diagnostics with stable location and threshold", () => {
		expect(formatLintDiagnostic(DIAGNOSTIC)).toBe(FORMATTED_DIAGNOSTIC);
	});

	it("returns no diagnostics for a clean program", async () => {
		expect(await lintFixture("export const answer = 42;\n")).toEqual([]);
	});

	it("sorts diagnostics by normalized path", () => {
		const laterPath = sourceFile("a/../b.ts", "function later() {}\n");
		const earlierPath = sourceFile("z/../a.ts", "function earlier() {}\n");
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

	it("does not use cryptic generated literal constant names", async () => {
		const sourcePaths = await readdir(SOURCE_DIRECTORY, { recursive: true });
		const typescriptPaths = sourcePaths.filter((path) =>
			path.endsWith(TYPESCRIPT_EXTENSION),
		);
		const sourceFiles = await Promise.all(
			typescriptPaths.map((path) =>
				readFile(join(SOURCE_DIRECTORY, path), "utf8"),
			),
		);

		expect(
			sourceFiles.some((source) =>
				CRYPTIC_LITERAL_CONSTANT_PATTERN.test(source.toString()),
			),
		).toBe(false);
	});
});
