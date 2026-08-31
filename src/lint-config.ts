import { readFile } from "node:fs/promises";

export interface LintConfig {
	maxCyclomaticComplexity: number;
	maxFunctionLines: number;
	maxFunctionsPerFile: number;
	maxNestedFunctionDepth: number;
	maxBooleanChecks: number;
}

export const DEFAULT_LINT_CONFIG: LintConfig = {
	maxCyclomaticComplexity: 10,
	maxFunctionLines: 50,
	maxFunctionsPerFile: 10,
	maxNestedFunctionDepth: 2,
	maxBooleanChecks: 2,
};

const CONFIG_KEYS: readonly (keyof LintConfig)[] = [
	"maxCyclomaticComplexity",
	"maxFunctionLines",
	"maxFunctionsPerFile",
	"maxNestedFunctionDepth",
	"maxBooleanChecks",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function loadLintConfig(
	path = "lint.config.json",
): Promise<LintConfig> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isRecord(parsed)) return { ...DEFAULT_LINT_CONFIG };
		const config = { ...DEFAULT_LINT_CONFIG };
		for (const key of CONFIG_KEYS) {
			const value = parsed[key];
			if (isPositiveInteger(value)) config[key] = value;
		}
		return config;
	} catch {
		return { ...DEFAULT_LINT_CONFIG };
	}
}
