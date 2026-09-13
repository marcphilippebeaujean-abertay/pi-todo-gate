import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";
import { isScopedModulePath } from "../../src/lint/rules/no-direct-module-state-write.ts";

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

	it("rejects mutating module-state calls", async () => {
		const diagnostics = await lintModuleSource(`
export function update(sessionState: { moduleState: { todoist: { tasks: string[] } } }) {
	 sessionState.moduleState.todoist.tasks.push("task");
	 Object.assign(sessionState.moduleState.todoist.tasks, {});
	 ({ tasks: sessionState.moduleState.todoist.tasks } = { tasks: [] });
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			3,
		);
	});

	it("rejects module publishers bound to another module", async () => {
		const diagnostics = await lintModuleSource(`
import { createModuleStatePublisher } from "../../event-publishers.ts";
const publisher = createModuleStatePublisher(eventHandler, "todoist");
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("allows module publisher bound to its own module", async () => {
		const diagnostics = await lintModuleSource(`
import { createModuleStatePublisher } from "../../event-publishers.ts";
const publisher = createModuleStatePublisher(eventHandler, "pr");
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});

	it("rejects computed module-state assignments", async () => {
		const diagnostics = await lintModuleSource(`
export function update(sessionState: { moduleState: Record<string, unknown> }) {
	sessionState["moduleState"].pr = {};
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("matches Windows-style scoped module paths", () => {
		expect(isScopedModulePath("C:\\repo\\src\\pr\\module.ts")).toBe(true);
	});

	it("rejects root assignments outside sanctioned updater", async () => {
		const diagnostics = await lintModuleSource(
			`export function mutate(state: { moduleState: Record<string, unknown> }) {
	state.moduleState.pr = {};
}
`,
			"root",
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("rejects shadowed sanctioned updater names", async () => {
		const diagnostics = await lintModuleSource(
			`export function wrapper(state: { moduleState: Record<string, unknown> }) {
	 function updateModuleState() {
		 state.moduleState.pr = {};
	 }
}
`,
			"root",
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("allows sanctioned root state updater", async () => {
		const diagnostics = await lintModuleSource(
			`export function updateModuleState(state: { moduleState: Record<string, unknown> }) {
	state.moduleState.pr = {};
}
`,
			"root",
		);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});
});
