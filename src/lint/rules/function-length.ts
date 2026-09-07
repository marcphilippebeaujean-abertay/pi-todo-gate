import { diagnostic } from "../diagnostic.ts";
import { collectFunctionMetrics } from "../function-metrics.ts";
import type { LintRule } from "../types.ts";

const RULE_ID = "function-length" as const;
const MESSAGE = "Function exceeds maximum length";

export const functionLength: LintRule = ({
	sourceFile,
	diagnostics,
	config,
}) => {
	for (const metric of collectFunctionMetrics(sourceFile)) {
		if (metric.lines <= config.maxFunctionLines) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				metric.node,
				RULE_ID,
				MESSAGE,
				metric.lines,
				config.maxFunctionLines,
			),
		);
	}
};
