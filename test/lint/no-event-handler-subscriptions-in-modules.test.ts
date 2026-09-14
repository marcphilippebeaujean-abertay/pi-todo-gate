import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-handler-subscriptions-";
const RULE_ID = "no-event-handler-subscriptions-in-modules";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

async function lintModule(
	fileName: string,
	source: string,
): Promise<ReturnType<typeof lintProgram>> {
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
	it("rejects EventHandler subscriptions from module.ts", async () => {
		const diagnostics = await lintModule(
			"module.ts",
			`interface EventHandler { foo: { subscribe(callback: () => void): () => void } }
declare const eventHandler: EventHandler;
declare const operations: { eventHandler: EventHandler };
class Module {
	private eventHandler: EventHandler = eventHandler;
	listen(): void {
		eventHandler.foo.subscribe(() => undefined);
		this.eventHandler.foo.subscribe(() => undefined);
		operations.eventHandler.foo.subscribe(() => undefined);
		const alias = operations.eventHandler;
		alias.foo.subscribe(() => undefined);
		const typedAlias: EventHandler = operations.eventHandler;
		typedAlias.foo.subscribe(() => undefined);
		const { eventHandler: destructured } = operations;
		destructured.foo.subscribe(() => undefined);
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(6);
	});

	it("rejects EventHandler subscriptions from other scoped facets", async () => {
		const diagnostics = await lintModule(
			"commands.ts",
			`interface EventHandler { foo: { subscribe(callback: () => void): () => void } }
declare const eventHandler: EventHandler;
eventHandler.foo.subscribe(() => undefined);
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("allows EventHandler subscriptions from event-consumers.ts", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`interface EventHandler { foo: { subscribe(callback: () => void): () => void } }
declare const eventHandler: EventHandler;
eventHandler.foo.subscribe(() => undefined);
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("allows unrelated subscriptions from module.ts", async () => {
		const diagnostics = await lintModule(
			"module.ts",
			`declare const eventHandler: { foo: { subscribe(callback: () => void): () => void } };
declare const event: { subscribe(callback: () => void): () => void };
eventHandler.foo.subscribe(() => undefined);
event.subscribe(() => undefined);
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
