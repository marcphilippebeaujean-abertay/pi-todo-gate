import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-no-direct-module-state-write-";
const RULE_ID = "no-direct-module-state-write";

async function lintModuleSource(source: string, directoryName = "pr") {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", directoryName);
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, "module.ts");
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
	it("rejects scoped module-state assignments", async () => {
		const diagnostics = await lintModuleSource(`
export function update(sessionState: { moduleState: { todoist: unknown } }) {
	sessionState.moduleState.todoist = {};
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("rejects computed module-state assignments", async () => {
		const diagnostics = await lintModuleSource(`
export function update(sessionState: { moduleState: Record<string, unknown> }) {
	sessionState.moduleState["todoist"] = {};
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("allows root state consumers to assign module slices", async () => {
		const diagnostics = await lintModuleSource(
			`export function update(state: { moduleState: Record<string, unknown> }) {
	state.moduleState.pr = {};
}
`,
			"root",
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});
});
