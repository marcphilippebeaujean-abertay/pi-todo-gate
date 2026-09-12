import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-no-functions-in-data-";
const DATA_FILE = "data.ts";
const RULE_ID = "no-functions-in-data";

async function lintDataSource(source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const filePath = join(root, DATA_FILE);
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
	it("rejects functions in data files in data files", async () => {
		const diagnostics = await lintDataSource(`
export function parse(value: unknown): unknown {
		return value;
}
export const normalize = (value: string): string => value.trim();
class Data {
	read() { return true; }
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			3,
		);
	});

	it("allows type-only data files", async () => {
		const diagnostics = await lintDataSource(`
export interface RecordData {
	name: string;
}
export type RecordId = string;
export const RECORD_KIND = "record";
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});
});
