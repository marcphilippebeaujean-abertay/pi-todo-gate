import type ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import {
	collectStringLiteralOccurrences,
	stringSimilarityPercent,
} from "../string-literals.ts";
import type { LintRule } from "../types.ts";
export const similarStringLiterals: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	const occurrences = collectStringLiteralOccurrences(sourceFile);
	const counts = new Map<string, number>();
	for (const occurrence of occurrences)
		counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
	const singletons = occurrences.filter(
		(occurrence) => counts.get(occurrence.text) === 1,
	);
	const matches = new Map<ts.Node, number>();
	for (let leftIndex = 0; leftIndex < singletons.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < singletons.length;
			rightIndex += 1
		) {
			const left = singletons[leftIndex];
			const right = singletons[rightIndex];
			const similarity = stringSimilarityPercent(left.text, right.text);
			if (similarity < 80) continue;
			matches.set(left.node, Math.max(matches.get(left.node) ?? 0, similarity));
			matches.set(
				right.node,
				Math.max(matches.get(right.node) ?? 0, similarity),
			);
		}
	}
	for (const occurrence of singletons) {
		const similarity = matches.get(occurrence.node);
		if (similarity !== undefined)
			diagnostics.push(
				diagnostic(
					sourceFile,
					occurrence.node,
					"similar-string-literals",
					"Similar string literals should share parameterized function",
					Math.round(similarity),
					80,
				),
			);
	}
};
