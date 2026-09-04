const OUTPUT_SEPARATOR = "\n";
const NO_MAGIC_STRINGS = "no-magic-strings";

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
	return name === "Bob" || name === "Bob";
}`;
const CLEAN_SOURCE = "export const answer = 42;\n";
const IMPORTING_SOURCE =
	'import "../other/secret";\nexport const answer = 42;\n';
const OUT_OF_SCOPE_SOURCE = `export function secret(name: string) {
	return name === "Bob";
}`;
const COLLECT_TEST = "collects only scoped TypeScript files in stable order";
const FAIL_TEST = "returns one when custom lint reports a violation";
const PASS_TEST = "returns zero for a clean project";
const STRICT_SCRIPT_TEST = "keeps lint command wired to strict checker";
const CI_WORKFLOW_TEST = "runs strict checks for pull requests";
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function makeRoot(source: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	await mkdir(join(root, SRC_DIRECTORY), { recursive: true });
	await writeFile(join(root, SRC_DIRECTORY, SOURCE_NAME), source);
	return root;
}

describe("lint CLI", () => {
	it(STRICT_SCRIPT_TEST, async () => {
		const packageJson = JSON.parse(
			await readFile(join(PROJECT_ROOT, "package.json"), "utf8"),
		) as { scripts?: Record<string, string> };

		expect(packageJson.scripts?.lint).toBe(
			"npm run lint:biome && npm run lint:strict",
		);
		expect(packageJson.scripts?.["lint:strict"]).toBe("tsx src/lint-cli.ts");
	});

	it(CI_WORKFLOW_TEST, async () => {
		const workflow = await readFile(
			join(PROJECT_ROOT, ".github/workflows/quality.yml"),
			"utf8",
		);

		expect(workflow).toContain("pull_request:");
		expect(workflow).toContain("npm ci");
		expect(workflow).toContain("npm run lint");
		expect(workflow).toContain("npm run typecheck");
		expect(workflow).toContain("npm test");
	});

	it(COLLECT_TEST, async () => {
		const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		await Promise.all([
			mkdir(join(root, SRC_DIRECTORY), { recursive: true }),
			mkdir(join(root, EXTENSIONS_DIRECTORY), { recursive: true }),
			mkdir(join(root, TEST_DIRECTORY), { recursive: true }),
			mkdir(join(root, TEST_DIRECTORY, "nested"), { recursive: true }),
			mkdir(join(root, SRC_DIRECTORY, "nested"), { recursive: true }),
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
			writeFile(
				join(root, TEST_DIRECTORY, "nested", SOURCE_NAME),
				MAGIC_SOURCE,
			),
			writeFile(
				join(root, SRC_DIRECTORY, "nested", LINT_INFRASTRUCTURE_NAME),
				CLEAN_SOURCE,
			),
			writeFile(join(root, OTHER_DIRECTORY, SOURCE_NAME), MAGIC_SOURCE),
		]);
		expect(collectLintFiles(root)).toEqual([
			join(root, EXTENSIONS_DIRECTORY, SOURCE_NAME),
			join(root, SRC_DIRECTORY, SOURCE_NAME),
			join(root, SRC_DIRECTORY, "nested", LINT_INFRASTRUCTURE_NAME),
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

	it("does not lint imported files outside explicit roots", async () => {
		const output: string[] = [];
		const root = await makeRoot(IMPORTING_SOURCE);
		await mkdir(join(root, OTHER_DIRECTORY), { recursive: true });
		await writeFile(
			join(root, OTHER_DIRECTORY, "secret.ts"),
			OUT_OF_SCOPE_SOURCE,
		);

		expect(await runLint(root, (line) => output.push(line))).toBe(0);
		expect(output.join(OUTPUT_SEPARATOR)).not.toContain(NO_MAGIC_STRINGS);
	});
});
