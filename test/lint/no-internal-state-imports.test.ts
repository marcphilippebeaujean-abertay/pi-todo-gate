import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-internal-state-imports-";
const RULE_ID = "no-internal-state-imports";

async function lintSource(
	sourcePath: string,
	moduleSpecifier: string,
	modulePath: string,
): Promise<ReturnType<typeof lintProgram>> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const sourceFilePath = join(root, "src", sourcePath);
	const targetFilePath = join(root, "src", modulePath);
	await mkdir(dirname(sourceFilePath), { recursive: true });
	await mkdir(dirname(targetFilePath), { recursive: true });
	await writeFile(
		sourceFilePath,
		`import type { State } from ${JSON.stringify(moduleSpecifier)};\n`,
	);
	await writeFile(
		targetFilePath,
		"export interface State { active: boolean; }\n",
	);
	const program = ts.createProgram([sourceFilePath], {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
	});
	return lintProgram(program, undefined, [sourceFilePath]);
}

function ruleDiagnostics(diagnostics: ReturnType<typeof lintProgram>) {
	return diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
}

describe(RULE_ID, () => {
	it("allows shared imports of module-state.ts", async () => {
		const diagnostics = await lintSource(
			"shared/events.ts",
			"../pr/module-state.ts",
			"pr/module-state.ts",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("rejects shared imports of internal-state.ts with shared-specific guidance", async () => {
		const diagnostics = await lintSource(
			"shared/events.ts",
			"../pr/internal-state.ts",
			"pr/internal-state.ts",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([
			expect.objectContaining({
				ruleId: RULE_ID,
				message:
					"Shared code may import module-state.ts, not internal-state.ts",
			}),
		]);
	});

	it("rejects root imports of internal-state.ts", async () => {
		const diagnostics = await lintSource(
			"main.ts",
			"./pr/internal-state.ts",
			"pr/internal-state.ts",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([
			expect.objectContaining({ ruleId: RULE_ID }),
		]);
	});

	it("rejects sibling-module imports of internal-state.ts", async () => {
		const diagnostics = await lintSource(
			"todoist/module.ts",
			"../pr/internal-state.ts",
			"pr/internal-state.ts",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([
			expect.objectContaining({ ruleId: RULE_ID }),
		]);
	});

	it("allows owning-module imports of internal-state.ts", async () => {
		const diagnostics = await lintSource(
			"pr/event-consumers.ts",
			"./internal-state.ts",
			"pr/internal-state.ts",
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
