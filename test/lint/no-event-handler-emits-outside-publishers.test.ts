import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-handler-emits-";
const RULE_ID = "no-event-handler-emits-outside-publishers";
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
	it("rejects typed direct, nested, alias, and destructured references", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`interface EventHandler { foo: { emit(value: unknown): Promise<void> } }
declare const eventHandler: EventHandler;
declare const operations: { eventHandler: EventHandler };
class Consumer {
	private eventHandler: EventHandler = eventHandler;
	publish(): void {
		void eventHandler.foo.emit(undefined);
		void this.eventHandler.foo.emit(undefined);
		void operations.eventHandler.foo.emit(undefined);
		const alias = operations.eventHandler;
		void alias.foo.emit(undefined);
		const typedAlias: EventHandler = operations.eventHandler;
		void typedAlias.foo.emit(undefined);
		const { eventHandler: destructured } = operations;
		void destructured.foo.emit(undefined);
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(6);
		expect(
			ruleDiagnostics(diagnostics).every(({ message }) =>
				message.includes("event-publishers.ts"),
			),
		).toBe(true);
	});

	it("rejects EventHandler emits from other scoped facets", async () => {
		const diagnostics = await lintModule(
			"commands.ts",
			`interface EventHandler { foo: { emit(value: unknown): Promise<void> } }
declare const eventHandler: EventHandler;
eventHandler.foo.emit(undefined);
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("allows publisher and unrelated Event emitter calls", async () => {
		const diagnostics = await lintModule(
			"event-publishers.ts",
			`declare const eventHandler: { foo: { emit(value: unknown): Promise<void> } };
declare const event: { emit(value: unknown): Promise<void> };
export function publish(): void {
	void eventHandler.foo.emit(undefined);
	void event.emit(undefined);
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("allows unrelated emitters, including locals named eventHandler", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`interface UnrelatedHandler { foo: { emit(value: unknown): Promise<void> } }
declare const event: { emit(value: unknown): Promise<void> };
declare const eventHandler: UnrelatedHandler;
class Consumer {
	private readonly emitter = event;
	publish(): void {
		void event.emit(undefined);
		void this.emitter.emit(undefined);
		void eventHandler.foo.emit(undefined);
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
