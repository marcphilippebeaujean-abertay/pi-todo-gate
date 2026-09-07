import { diagnostic } from "../diagnostic.ts";
import { collectFunctionMetrics } from "../function-metrics.ts";
import type { LintRule } from "../types.ts";

const RULE_ID = "nested-function-depth" as const;
const MESSAGE = "Function is nested too deeply";

export const nestedFunctionDepth: LintRule = ({
	sourceFile,
	diagnostics,
	config,
}) => {
	for (const metric of collectFunctionMetrics(sourceFile)) {
		if (metric.depth <= config.maxNestedFunctionDepth) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				metric.node,
				RULE_ID,
				MESSAGE,
				metric.depth,
				config.maxNestedFunctionDepth,
			),
		);
	}
};
