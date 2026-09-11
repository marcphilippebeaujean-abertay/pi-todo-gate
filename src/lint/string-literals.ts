import ts from "typescript";
import {
	isFunctionLike,
	isIgnoredString,
	isStringLiteralLike,
} from "./shared.ts";

export interface StringLiteralOccurrence {
	node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
	text: string;
}

export function collectStringLiteralOccurrences(
	sourceFile: ts.SourceFile,
): StringLiteralOccurrence[] {
	const occurrences: StringLiteralOccurrence[] = [];
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
			node.text.length >= 12 &&
			!isIgnoredString(node, resolvedAncestors)
		)
			occurrences.push({ node, text: node.text });
		if (ts.isTypeNode(node)) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...resolvedAncestors, node]),
		);
	}
	visit(sourceFile, false);
	return occurrences;
}

export function stringSimilarityPercent(left: string, right: string): number {
	const normalize = (value: string) =>
		value.toLowerCase().replace(/\s+/g, " ").trim();
	const normalizedLeft = normalize(left);
	const normalizedRight = normalize(right);
	const combinedLength = normalizedLeft.length + normalizedRight.length;
	if (combinedLength === 0) return 100;
	let previous = Array.from(
		{ length: normalizedRight.length + 1 },
		(_, index) => index,
	);
	for (let leftIndex = 1; leftIndex <= normalizedLeft.length; leftIndex += 1) {
		const current = [leftIndex];
		for (
			let rightIndex = 1;
			rightIndex <= normalizedRight.length;
			rightIndex += 1
		) {
			const substitutionCost =
				normalizedLeft[leftIndex - 1] === normalizedRight[rightIndex - 1]
					? 0
					: 1;
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + substitutionCost,
			);
		}
		previous = current;
	}
	return (1 - previous[normalizedRight.length] / combinedLength) * 100;
}
