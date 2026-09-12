import type ts from "typescript";
import type { LintConfig } from "./state.ts";
export type LintRuleId =
	| "commands-only-register"
	| "no-worker-consumer-callbacks"
	| "no-default-parameters"
	| "no-magic-strings"
	| "no-short-string-constants"
	| "similar-string-literals"
	| "no-complicated-expressions"
	| "named-if-condition"
	| "cyclomatic-complexity"
	| "function-length"
	| "functions-per-file"
	| "nested-function-depth"
	| "repeated-field-checks"
	| "prefer-switch-dispatch"
	| "domain-types-outside-state"
	| "no-extension-state-in-modules"
	| "event-types-outside-events"
	| "event-types-location"
	| "no-functions-in-data";
export interface LintDiagnostic {
	filePath: string;
	line: number;
	column: number;
	ruleId: LintRuleId;
	message: string;
	value: number;
	limit: number;
}
export interface LintContext {
	sourceFile: ts.SourceFile;
	diagnostics: LintDiagnostic[];
	checker: ts.TypeChecker;
	config: LintConfig;
}
export type LintRule = (context: LintContext) => void;
