import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-commands-only-register-";
const RULE_ID = "commands-only-register";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

async function lintFile(fileName: string, source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", "pr");
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, fileName);
	await writeFile(filePath, source);
	const program = ts.createProgram([filePath], COMPILER_OPTIONS);
	return lintProgram(program);
}

function ruleDiagnostics(
	diagnostics: ReturnType<typeof lintProgram>,
): ReturnType<typeof lintProgram> {
	return diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
}

describe(RULE_ID, () => {
	it("allows empty commands.ts", async () => {
		const diagnostics = await lintFile("commands.ts", "export {};\n");

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("allows only exported register function", async () => {
		const diagnostics = await lintFile(
			"commands.ts",
			`function helper(): void {}
export function register(): void { helper(); }
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("rejects other exported methods and data", async () => {
		const diagnostics = await lintFile(
			"commands.ts",
			`export function execute(): void {}
export const commandName = "merge";
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(2);
	});

	it("rejects exported methods listed through export clauses", async () => {
		const diagnostics = await lintFile(
			"commands.ts",
			`function execute(): void {}
export { execute };
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("does not apply outside commands.ts", async () => {
		const diagnostics = await lintFile(
			"events.ts",
			"export function execute(): void {}\n",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
