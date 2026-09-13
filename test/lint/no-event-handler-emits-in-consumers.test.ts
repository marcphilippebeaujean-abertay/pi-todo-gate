import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-handler-emits-";
const RULE_ID = "no-event-handler-emits-in-consumers";
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
	it("rejects direct and this EventHandler channel emits in consumers", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`declare const eventHandler: { foo: { emit(value: unknown): Promise<void> } };
class Consumer {
	private eventHandler = eventHandler;
	publish(): void {
		void eventHandler.foo.emit(undefined);
		void this.eventHandler.foo.emit(undefined);
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(2);
		expect(
			ruleDiagnostics(diagnostics).every(({ message }) =>
				message.includes("event-publishers.ts"),
			),
		).toBe(true);
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

	it("allows unrelated emit calls in consumers", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`declare const event: { emit(value: unknown): Promise<void> };
class Consumer {
	private readonly emitter = event;
	publish(): void {
		void event.emit(undefined);
		void this.emitter.emit(undefined);
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
