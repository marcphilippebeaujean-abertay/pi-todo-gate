import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { type LintDiagnostic, lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-lint-";
const FIXTURE_NAME = "fixture.ts";

export function ruleIds(diagnostics: readonly LintDiagnostic[]): string[] {
	return diagnostics.map((diagnostic) => diagnostic.ruleId);
}

export async function lintFixture(
	source: string,
	config: Partial<import("../../src/lint-config.ts").LintConfig> = {},
): Promise<LintDiagnostic[]> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const filePath = join(root, FIXTURE_NAME);
	await writeFile(filePath, source);
	const program = ts.createProgram([filePath], {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
	});
	return lintProgram(program, config);
}
