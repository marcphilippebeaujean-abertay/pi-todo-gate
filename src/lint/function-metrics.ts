import ts from "typescript";
import { isFunctionLike, isLogicalExpression } from "./shared.ts";
export interface FunctionMetric {
	node: ts.FunctionLikeDeclaration;
	depth: number;
	complexity: number;
	lines: number;
}
function functionComplexity(body: ts.Node): number {
	let complexity = 1;
	function visit(node: ts.Node): void {
		if (node !== body && isFunctionLike(node)) return;
		if (
			ts.isIfStatement(node) ||
			ts.isForStatement(node) ||
			ts.isForInStatement(node) ||
			ts.isForOfStatement(node) ||
			ts.isWhileStatement(node) ||
			ts.isDoStatement(node) ||
			ts.isCatchClause(node) ||
			ts.isConditionalExpression(node) ||
			ts.isCaseClause(node) ||
			ts.isDefaultClause(node) ||
			(isLogicalExpression(node) &&
				node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken)
		)
			complexity += 1;
		ts.forEachChild(node, visit);
	}
	visit(body);
	return complexity;
}
export function collectFunctionMetrics(
	sourceFile: ts.SourceFile,
): FunctionMetric[] {
	const metrics: FunctionMetric[] = [];
	function visit(node: ts.Node, containingFunctionDepth: number): void {
		if (isFunctionLike(node)) {
			const depth = containingFunctionDepth + 1;
			const start = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile),
			);
			const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
			metrics.push({
				node,
				depth,
				complexity: node.body ? functionComplexity(node.body) : 1,
				lines: end.line - start.line + 1,
			});
			ts.forEachChild(node, (child) => visit(child, depth));
			return;
		}
		ts.forEachChild(node, (child) => visit(child, containingFunctionDepth));
	}
	visit(sourceFile, 0);
	return metrics;
}
