import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-extension-state-import-";
const RULE_ID = "no-root-state-imports-in-modules";

async function lintModule(source: string, directoryName = "pr") {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", directoryName);
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(root, "src", "state.ts"),
		[
			"export interface SessionState {}",
			"export interface ExtensionState {}",
			"export interface SessionContext {}",
			"export function applyStatePatch() {}",
			"export function currentSessionContext() {}",
		].join("\\n"),
	);
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
	it.each([
		"ExtensionState",
		"SessionContext",
		"applyStatePatch",
		"currentSessionContext",
	])("rejects %s imports from scoped modules", async (binding) => {
		const diagnostics = await lintModule(
			`import type { ${binding} } from "../state.ts";\n`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("reports each forbidden root-state binding once", async () => {
		const diagnostics = await lintModule(
			`import { ExtensionState, SessionContext, applyStatePatch } from "../state.ts";\n`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			3,
		);
	});

	it("allows SessionState imports from every scoped module", async () => {
		for (const directory of [
			"pr",
			"todoist",
			"herdr",
			"worktree",
			"exit-protocol",
			"footer",
		]) {
			const diagnostics = await lintModule(
				`import type { SessionState } from "../state.ts";\n`,
				directory,
			);
			expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual(
				[],
			);
		}
	});

	it("rejects namespace root-state bindings", async () => {
		const diagnostics = await lintModule(
			`import * as rootState from "../state.ts";\n`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("rejects forbidden export aliases from root state", async () => {
		const diagnostics = await lintModule(
			`export { ExtensionState as E } from "../state.ts";\n`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("rejects root-state star re-exports", async () => {
		const diagnostics = await lintModule(`export * from "../state.ts";\n`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("allows SessionState re-exports from root state", async () => {
		const diagnostics = await lintModule(
			`export { SessionState } from "../state.ts";\n`,
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});
});
