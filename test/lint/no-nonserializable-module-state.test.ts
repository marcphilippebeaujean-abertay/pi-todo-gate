import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-module-state-contract-";
const RULE_ID = "module-state-contract";

async function lintStateSource(source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src");
	await mkdir(directory, { recursive: true });
	const moduleDirectory = join(directory, "pr");
	await mkdir(moduleDirectory, { recursive: true });
	const filePath = join(moduleDirectory, "module-state.ts");
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
	it("allows JSON-compatible module state", async () => {
		const diagnostics = await lintStateSource(`
export interface PrModuleState {
	prUrl?: string;
	discoveryTestedUrls: string[];
}
export interface ModuleState {
	pr: PrModuleState;
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});

	it("rejects runtime-only module state types", async () => {
		const diagnostics = await lintStateSource(`
interface ExtensionContext {}
interface BadModuleState {
	pending: Promise<void>;
	seen: Set<string>;
	callback: () => void;
	context: ExtensionContext;
}
export interface ModuleState {
	pr: BadModuleState;
}
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(4);
		expect(findings.map(({ line, column }) => ({ line, column }))).toEqual([
			{ line: 4, column: 11 },
			{ line: 5, column: 8 },
			{ line: 6, column: 12 },
			{ line: 7, column: 11 },
		]);
	});

	it("rejects one diagnostic per property with multiple forbidden types", async () => {
		const diagnostics = await lintStateSource(`
interface BadModuleState {
	value: Promise<void> | Set<string>;
}
export interface ModuleState {
	pr: BadModuleState;
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("rejects non-serializable index and call signatures", async () => {
		const diagnostics = await lintStateSource(`
interface BadModuleState {
	[key: string]: Set<string>;
	(): void;
}
export interface ModuleState {
	pr: BadModuleState;
}
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(2);
		expect(findings.map(({ line, column }) => ({ line, column }))).toEqual([
			{ line: 3, column: 17 },
			{ line: 4, column: 2 },
		]);
	});

	it("rejects class instances reachable from module state", async () => {
		const diagnostics = await lintStateSource(`
class RuntimeHandle {}
interface BadModuleState {
	handle: RuntimeHandle;
}
export interface ModuleState {
	pr: BadModuleState;
}
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(2);
		expect(findings.map(({ line, column }) => ({ line, column }))).toEqual([
			{ line: 2, column: 1 },
			{ line: 4, column: 10 },
		]);
	});
});
