import ts from "typescript";
import { DEFAULT_LINT_CONFIG } from "../lint-config.ts";
import { compareDiagnostics } from "./diagnostic.ts";
import { cyclomaticComplexity } from "./rules/cyclomatic-complexity.ts";
import { functionLength } from "./rules/function-length.ts";
import { functionsPerFile } from "./rules/functions-per-file.ts";
import { namedIfCondition } from "./rules/named-if-condition.ts";
import { nestedFunctionDepth } from "./rules/nested-function-depth.ts";
import { noComplicatedExpressions } from "./rules/no-complicated-expressions.ts";
import { noDefaultParameters } from "./rules/no-default-parameters.ts";
import { noFunctionsInData } from "./rules/no-functions-in-data.ts";
import { noMagicStrings } from "./rules/no-magic-strings.ts";
import { noShortStringConstants } from "./rules/no-short-string-constants.ts";
import { noWorkerConsumerCallbacks } from "./rules/no-worker-consumer-callbacks.ts";
import { preferSwitchDispatch } from "./rules/prefer-switch-dispatch.ts";
import { repeatedFieldChecks } from "./rules/repeated-field-checks.ts";
import { similarStringLiterals } from "./rules/similar-string-literals.ts";
import type { LintContext, LintDiagnostic, LintRule } from "./types.ts";

export { formatLintDiagnostic } from "./diagnostic.ts";
export type { LintDiagnostic, LintRuleId } from "./types.ts";

const RULES: readonly LintRule[] = [
	noWorkerConsumerCallbacks,
	noDefaultParameters,
	noShortStringConstants,
	noMagicStrings,
	similarStringLiterals,
	namedIfCondition,
	noFunctionsInData,
	repeatedFieldChecks,
	preferSwitchDispatch,
	noComplicatedExpressions,
	cyclomaticComplexity,
	functionLength,
	functionsPerFile,
	nestedFunctionDepth,
];

export function lintProgram(
	program: ts.Program,
	config?: Partial<import("../lint-config.ts").LintConfig>,
	lintRoots?: readonly string[],
): LintDiagnostic[] {
	const resolvedConfig = { ...DEFAULT_LINT_CONFIG, ...(config ?? {}) };
	const diagnostics: LintDiagnostic[] = [];
	const checker = program.getTypeChecker();
	const explicitRoots = lintRoots
		? new Set(lintRoots.map((filePath) => ts.sys.resolvePath(filePath)))
		: undefined;
	for (const sourceFile of program.getSourceFiles()) {
		if (
			sourceFile.isDeclarationFile ||
			(explicitRoots !== undefined &&
				!explicitRoots.has(ts.sys.resolvePath(sourceFile.fileName)))
		)
			continue;
		const context: LintContext = {
			sourceFile,
			diagnostics,
			checker,
			config: resolvedConfig,
		};
		for (const rule of RULES) rule(context);
	}
	return diagnostics.sort(compareDiagnostics);
}
