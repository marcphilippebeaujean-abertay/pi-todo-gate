import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-commands-require-tg-prefix-";
const RULE_ID = "commands-require-tg-prefix";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};
const COMMAND_API = `declare const pi: {
	registerCommand(name: string, options: unknown): void;
};
`;

async function lintSource(source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", "pr");
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, "commands.ts");
	await writeFile(filePath, `${COMMAND_API}${source}`);
	const program = ts.createProgram([filePath], COMPILER_OPTIONS);
	return lintProgram(program);
}

function ruleDiagnostics(
	diagnostics: ReturnType<typeof lintProgram>,
): ReturnType<typeof lintProgram> {
	return diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
}

describe(RULE_ID, () => {
	it("allows registered commands with tg_ prefix", async () => {
		const diagnostics = await lintSource(
			'pi.registerCommand("tg_merge", {});\n',
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("rejects registered commands without tg_ prefix", async () => {
		const diagnostics = await lintSource('pi.registerCommand("merge", {});\n');

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("rejects dynamic registered command names", async () => {
		const diagnostics = await lintSource(
			`declare const command: string;
pi.registerCommand(command, {});
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});
});
