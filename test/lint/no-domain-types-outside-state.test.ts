import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-domain-types-in-state-";
const RULE_ID = "domain-types-outside-state";

async function lintSource(domain: string, file: string, source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", domain);
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, file);
	await writeFile(filePath, source);
	const program = ts.createProgram([filePath], {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
	});
	return lintProgram(program);
}

describe(RULE_ID, () => {
	it("rejects interfaces and type aliases outside state.ts", async () => {
		const diagnostics = await lintSource(
			"pr",
			"commands.ts",
			`interface Runtime { active: boolean; }
type Result = string;
`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			2,
		);
	});

	it("allows declarations in every module state.ts", async () => {
		const diagnostics = await lintSource(
			"footer",
			"state.ts",
			`interface FooterState { visible: boolean; }
type FooterId = string;
`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});
});
