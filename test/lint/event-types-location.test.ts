import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-types-location-";
const RULE_ID = "event-types-location";
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
	it("allows payload and event-bus contracts in events.ts", async () => {
		const diagnostics = await lintFile(
			"events.ts",
			`export interface ClaimCompletedEvent { value: string; }
export type EventPayloads = { claimCompleted: ClaimCompletedEvent };
export type EventName = keyof EventPayloads;
export type EventListener = (payload: ClaimCompletedEvent) => void;
export interface Events { emit: EventListener; }
`,
		);

		expect(diagnostics).toEqual([]);
	});

	it("rejects event-related declarations in state.ts", async () => {
		const diagnostics = await lintFile(
			"state.ts",
			`export interface ClaimCompletedEvent { value: string; }
export type HerdrEvents = { emit: () => void };
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(2);
	});

	it("rejects event-related declarations in other domain files", async () => {
		const diagnostics = await lintFile(
			"commands.ts",
			`export interface CommandEvent { value: string; }
export type EventListener = () => void;
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(2);
	});

	it("ignores declarations without event in their names", async () => {
		const diagnostics = await lintFile(
			"state.ts",
			`export interface HerdrState { value: string; }
export type ClaimWorkerRequest = { value: string };
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
