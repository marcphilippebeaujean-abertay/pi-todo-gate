import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LINT_CONFIG, loadLintConfig } from "../src/lint-config.ts";

const TEMP_PREFIX = "pi-todo-gate-lint-config-";
const CONFIG_NAME = "lint.config.json";
const INVALID_CONFIG = JSON.stringify({ maxFunctionLines: 0, maxFunctionsPerFile: "11" });
const DEFAULTS = {
	maxCyclomaticComplexity: 10,
	maxFunctionLines: 50,
	maxFunctionsPerFile: 10,
	maxNestedFunctionDepth: 2,
	maxBooleanChecks: 2,
};
const MISSING_CONFIG_TEST = "uses strict lint defaults when config is absent";
const INVALID_CONFIG_TEST = "ignores malformed and non-positive overrides";

describe("lint configuration", () => {
	it(MISSING_CONFIG_TEST, async () => {
		await expect(loadLintConfig("missing-lint.config.json")).resolves.toEqual(DEFAULTS);
		expect(DEFAULT_LINT_CONFIG).toEqual(DEFAULTS);
	});

	it(INVALID_CONFIG_TEST, async () => {
		const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const configPath = join(root, CONFIG_NAME);
		await writeFile(configPath, INVALID_CONFIG);
		await expect(loadLintConfig(configPath)).resolves.toEqual(DEFAULTS);
	});
});
