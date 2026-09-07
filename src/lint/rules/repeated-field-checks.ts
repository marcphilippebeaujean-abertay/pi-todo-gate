import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import {
	isEqualityOperator,
	isFunctionLike,
	unparenthesized,
} from "../shared.ts";
import type { LintRule } from "../types.ts";

function equalityPropertyAccesses(
	node: ts.Node,
): ts.PropertyAccessExpression[] {
	if (
		!ts.isBinaryExpression(node) ||
		!isEqualityOperator(node.operatorToken.kind)
	)
		return [];
	const left = unparenthesized(node.left);
	return ts.isPropertyAccessExpression(left) ? [left] : [];
}
export const repeatedFieldChecks: LintRule = ({ sourceFile, diagnostics }) => {
	function visit(node: ts.Node): void {
		if (isFunctionLike(node) && node.body) {
			const accesses = new Map<string, ts.PropertyAccessExpression[]>();
			function visitBody(current: ts.Node): void {
				for (const access of equalityPropertyAccesses(current)) {
					const key = access.getText(sourceFile);
					const occurrences = accesses.get(key) ?? [];
					occurrences.push(access);
					accesses.set(key, occurrences);
				}
				ts.forEachChild(current, (child) => {
					if (!isFunctionLike(child)) visitBody(child);
				});
			}
			visitBody(node.body);
			for (const occurrences of accesses.values())
				if (occurrences.length > 1 && occurrences[1])
					diagnostics.push(
						diagnostic(
							sourceFile,
							occurrences[1],
							"repeated-field-checks",
							"Repeated field checks should use a local variable",
							occurrences.length,
							1,
						),
					);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
