import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import {
	isConstInitializer,
	isSingleCharacterLiteral,
	isStringLiteralLike,
} from "../shared.ts";
import type { LintRule } from "../types.ts";
export const noShortStringConstants: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	function visit(node: ts.Node, ancestors?: readonly ts.Node[]): void {
		const resolvedAncestors = ancestors ?? [];
		if (
			isSingleCharacterLiteral(node) &&
			isConstInitializer(node, resolvedAncestors)
		)
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					"no-short-string-constants",
					"String constants must contain at least two characters",
					isStringLiteralLike(node) ? node.text.length : 0,
					1,
				),
			);
		ts.forEachChild(node, (child) =>
			visit(child, [...resolvedAncestors, node]),
		);
	}
	visit(sourceFile);
};
