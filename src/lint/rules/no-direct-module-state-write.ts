import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/].+\.ts$/;
const MODULE_STATE_NAME = "moduleState";
const RULE_ID = "no-direct-module-state-write" as const;
const MESSAGE =
	"Scoped modules must publish module state through the root state updater";

function isAssignment(node: ts.BinaryExpression): boolean {
	return node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment;
}

function readsModuleState(node: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(node)) {
		if (node.name.text === MODULE_STATE_NAME) return true;
		return readsModuleState(node.expression);
	}
	if (ts.isElementAccessExpression(node))
		return readsModuleState(node.expression);
	return false;
}

function isWriteExpression(node: ts.Node): boolean {
	if (ts.isBinaryExpression(node)) return isAssignment(node);
	if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
		return (
			node.operator === ts.SyntaxKind.PlusPlus ||
			node.operator === ts.SyntaxKind.MinusMinus
		);
	if (ts.isDeleteExpression(node)) return true;
	return false;
}

export const noDirectModuleStateWrite: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	if (!MODULE_PATH.test(sourceFile.fileName)) return;
	function visit(node: ts.Node): void {
		const isWrite = isWriteExpression(node);
		const target = ts.isBinaryExpression(node)
			? node.left
			: ts.isDeleteExpression(node)
				? node.expression
				: ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)
					? node.operand
					: null;
		if (isWrite && target !== null && readsModuleState(target))
			diagnostics.push(diagnostic(sourceFile, target, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
