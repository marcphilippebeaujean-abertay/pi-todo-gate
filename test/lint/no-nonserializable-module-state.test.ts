import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-no-nonserializable-module-state-";
const RULE_ID = "no-nonserializable-module-state";

async function lintStateSource(source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src");
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, "state.ts");
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

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			4,
		);
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

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			2,
		);
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

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});
});
