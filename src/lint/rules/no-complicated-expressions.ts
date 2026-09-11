import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import {
	hasLogicalParent,
	isLogicalExpression,
	logicalCheckCount,
} from "../shared.ts";
import type { LintRule } from "../types.ts";

export const noComplicatedExpressions: LintRule = ({
	sourceFile,
	diagnostics,
	config,
}) => {
	function visit(node: ts.Node, ancestors?: readonly ts.Node[]): void {
		const resolvedAncestors = ancestors ?? [];

		if (isLogicalExpression(node) && !hasLogicalParent(resolvedAncestors)) {
			const checks = logicalCheckCount(node);
			if (checks > config.maxBooleanChecks)
				diagnostics.push(
					diagnostic(
						sourceFile,
						node,
						"no-complicated-expressions",
						"Boolean expression has too many checks",
						checks,
						config.maxBooleanChecks,
					),
				);
		}
		ts.forEachChild(node, (child) =>
			visit(child, [...resolvedAncestors, node]),
		);
	}
	visit(sourceFile);
};
