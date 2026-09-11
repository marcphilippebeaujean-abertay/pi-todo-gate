import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import {
	isFunctionLike,
	isIgnoredString,
	isStringLiteralLike,
} from "../shared.ts";
import type { LintRule } from "../types.ts";

const RULE = "no-magic-strings" as const;
export const noMagicStrings: LintRule = ({ sourceFile, diagnostics }) => {
	const occurrences: {
		node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
		text: string;
	}[] = [];
	function visit(
		node: ts.Node,
		insideFunction: boolean,
		ancestors?: readonly ts.Node[],
	): void {
		const resolvedAncestors = ancestors ?? [];
		const currentInsideFunction = insideFunction || isFunctionLike(node);
		if (
			currentInsideFunction &&
			isStringLiteralLike(node) &&
			!isIgnoredString(node, resolvedAncestors)
		)
			occurrences.push({ node, text: node.text });
		if (ts.isTypeNode(node)) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...resolvedAncestors, node]),
		);
	}
	visit(sourceFile, false);
	const counts = new Map<string, number>();
	for (const occurrence of occurrences)
		counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
	for (const occurrence of occurrences) {
		const count = counts.get(occurrence.text) ?? 0;
		if (count > 1)
			diagnostics.push(
				diagnostic(
					sourceFile,
					occurrence.node,
					RULE,
					"String literal must use named constant",
					count,
					0,
				),
			);
	}
};
