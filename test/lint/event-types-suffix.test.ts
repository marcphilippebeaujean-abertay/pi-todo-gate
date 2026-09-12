import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-types-suffix-";
const RULE_ID = "event-types-suffix";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

async function lintFile(fileName: string, source: string) {
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
	it("requires every interface and type alias in events.ts to end with Event", async () => {
		const diagnostics = await lintFile(
			"events.ts",
			`interface ValidEvent { value: string; }
type ValidAliasEvent = string;
const ValidDataEvent = { value: "ok" };
interface InvalidPayload { value: string; }
type InvalidAlias = string;
const InvalidData = { value: "no" };
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(3);
	});

	it("allows event declarations with Event suffix", async () => {
		const diagnostics = await lintFile(
			"events.ts",
			`export interface EventPayloadEvent { value: string; }
export type EventNameEvent = "created";
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("does not apply to state or non-event files", async () => {
		const stateDiagnostics = await lintFile(
			"state.ts",
			"interface StatePayload { value: string; }\n",
		);
		const commandDiagnostics = await lintFile(
			"commands.ts",
			"interface CommandOptions { value: string; }\n",
		);

		expect(ruleDiagnostics(stateDiagnostics)).toEqual([]);
		expect(ruleDiagnostics(commandDiagnostics)).toEqual([]);
	});
});
