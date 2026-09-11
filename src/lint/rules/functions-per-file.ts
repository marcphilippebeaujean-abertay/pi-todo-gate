import { diagnostic } from "../diagnostic.ts";
import { collectFunctionMetrics } from "../function-metrics.ts";
import type { LintRule } from "../types.ts";

const RULE_ID = "functions-per-file" as const;
const MESSAGE = "File contains too many functions";

export const functionsPerFile: LintRule = ({
	sourceFile,
	diagnostics,
	config,
}) => {
	const canonicalFacet =
		/\/src\/(pr|todoist|herdr|worktree|exit-protocol|footer)\/(commands|constants|data|event-consumers|event-publishers|user-prompts|notifications|module|footer-rendering|parsing|state|claim-worker-result|tab-validation)\.ts$/.test(
			sourceFile.fileName,
		);
	const count = collectFunctionMetrics(sourceFile).length;
	if (canonicalFacet || count <= config.maxFunctionsPerFile) return;
	diagnostics.push(
		diagnostic(
			sourceFile,
			sourceFile,
			RULE_ID,
			MESSAGE,
			count,
			config.maxFunctionsPerFile,
		),
	);
};
