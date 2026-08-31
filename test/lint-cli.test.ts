const OUTPUT_SEPARATOR = "\n";
const NO_MAGIC_STRINGS = "no-magic-strings";

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectLintFiles, runLint } from "../src/lint-cli.ts";

const TEMP_PREFIX = "pi-todo-gate-lint-cli-";
const SRC_DIRECTORY = "src";
const EXTENSIONS_DIRECTORY = "extensions";
const TEST_DIRECTORY = "test";
const OTHER_DIRECTORY = "other";
const LINT_INFRASTRUCTURE_NAME = "lint.ts";
const SOURCE_NAME = "example.ts";
const MAGIC_SOURCE = `export function check(name: string) {
	return name === "Bob";
}`;
const CLEAN_SOURCE = "export const answer = 42;\n";
const COLLECT_TEST = "collects only scoped TypeScript files in stable order";
const FAIL_TEST = "returns one when custom lint reports a violation";
const PASS_TEST = "returns zero for a clean project";

async function makeRoot(source: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	await mkdir(join(root, SRC_DIRECTORY), { recursive: true });
	await writeFile(join(root, SRC_DIRECTORY, SOURCE_NAME), source);
	return root;
}

describe("lint CLI", () => {
	it(COLLECT_TEST, async () => {
		const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		await Promise.all([
			mkdir(join(root, SRC_DIRECTORY), { recursive: true }),
			mkdir(join(root, EXTENSIONS_DIRECTORY), { recursive: true }),
			mkdir(join(root, TEST_DIRECTORY), { recursive: true }),
			mkdir(join(root, OTHER_DIRECTORY), { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(root, SRC_DIRECTORY, SOURCE_NAME), CLEAN_SOURCE),
			writeFile(
				join(root, SRC_DIRECTORY, LINT_INFRASTRUCTURE_NAME),
				MAGIC_SOURCE,
			),
			writeFile(join(root, EXTENSIONS_DIRECTORY, SOURCE_NAME), CLEAN_SOURCE),
			writeFile(join(root, TEST_DIRECTORY, SOURCE_NAME), MAGIC_SOURCE),
			writeFile(join(root, OTHER_DIRECTORY, SOURCE_NAME), MAGIC_SOURCE),
		]);
		expect(collectLintFiles(root)).toEqual([
			join(root, EXTENSIONS_DIRECTORY, SOURCE_NAME),
			join(root, SRC_DIRECTORY, SOURCE_NAME),
		]);
	});

	it(FAIL_TEST, async () => {
		const output: string[] = [];
		const root = await makeRoot(MAGIC_SOURCE);
		expect(await runLint(root, (line) => output.push(line))).toBe(1);
		expect(output.join(OUTPUT_SEPARATOR)).toContain(NO_MAGIC_STRINGS);
	});

	it(PASS_TEST, async () => {
		const root = await makeRoot(CLEAN_SOURCE);
		expect(await runLint(root, () => undefined)).toBe(0);
	});
});
