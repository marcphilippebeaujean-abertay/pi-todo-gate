import { diagnostic } from "../diagnostic.ts";
import { collectFunctionMetrics } from "../function-metrics.ts";
import type { LintRule } from "../types.ts";

const RULE_ID = "cyclomatic-complexity" as const;
const MESSAGE = "Function exceeds cyclomatic complexity";

export const cyclomaticComplexity: LintRule = ({
	sourceFile,
	diagnostics,
	config,
}) => {
	for (const metric of collectFunctionMetrics(sourceFile)) {
		if (metric.complexity <= config.maxCyclomaticComplexity) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				metric.node,
				RULE_ID,
				MESSAGE,
				metric.complexity,
				config.maxCyclomaticComplexity,
			),
		);
	}
};
