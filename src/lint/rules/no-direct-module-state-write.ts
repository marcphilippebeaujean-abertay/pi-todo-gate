import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/].+\.ts$/;
const ROOT_PATH = /[\\/]src[\\/].+\.ts$/;
const MODULE_STATE_NAME = "moduleState";
const RULE_ID = "no-direct-module-state-write" as const;
const MESSAGE = "Module state must be changed through the root state updater";
const SANCTIONED_ROOT_WRITERS = new Set([
	"updateModuleState",
	"resetSessionState",
	"activateConfigured",
	"serializeSessionState",
	"restoreSessionState",
]);

export function isScopedModulePath(filePath: string): boolean {
	return MODULE_PATH.test(filePath);
}

function isAssignment(node: ts.BinaryExpression): boolean {
	return node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment;
}

function readsModuleState(node: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(node)) {
		if (node.name.text === MODULE_STATE_NAME) return true;
		return readsModuleState(node.expression);
	}
	if (ts.isElementAccessExpression(node)) {
		const argument = node.argumentExpression;
		const isModuleStateAccess =
			argument !== undefined &&
			((ts.isStringLiteral(argument) && argument.text === MODULE_STATE_NAME) ||
				(ts.isIdentifier(argument) && argument.text === MODULE_STATE_NAME));
		if (isModuleStateAccess) return true;
		return readsModuleState(node.expression);
	}
	return false;
}

function isWriteExpression(node: ts.Node): boolean {
	if (ts.isBinaryExpression(node)) return isAssignment(node);
	if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
		return (
			node.operator === ts.SyntaxKind.PlusPlusToken ||
			node.operator === ts.SyntaxKind.MinusMinusToken
		);
	if (ts.isDeleteExpression(node)) return true;
	return false;
}

function containingFunction(node: ts.Node): ts.Node | null {
	let current: ts.Node | undefined = node.parent;
	while (current !== undefined) {
		const isFunction =
			ts.isFunctionDeclaration(current) ||
			ts.isMethodDeclaration(current) ||
			ts.isFunctionExpression(current) ||
			ts.isArrowFunction(current);
		if (isFunction) return current;
		current = current.parent;
	}
	return null;
}

function isAllowedRootWrite(node: ts.Node, sourceFile: ts.SourceFile): boolean {
	const functionNode = containingFunction(node);
	const isTopLevelDeclaration =
		functionNode !== null &&
		ts.isFunctionDeclaration(functionNode) &&
		functionNode.parent === sourceFile;
	if (!isTopLevelDeclaration || !ts.isFunctionDeclaration(functionNode))
		return false;
	const functionName = functionNode.name?.text;
	return (
		functionName !== undefined && SANCTIONED_ROOT_WRITERS.has(functionName)
	);
}

export const noDirectModuleStateWrite: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	const isModuleFile = isScopedModulePath(sourceFile.fileName);
	const isRootFile = ROOT_PATH.test(sourceFile.fileName);
	if (!isModuleFile && !isRootFile) return;
	function visit(node: ts.Node): void {
		const isWrite = isWriteExpression(node);
		const target = ts.isBinaryExpression(node)
			? node.left
			: ts.isDeleteExpression(node)
				? node.expression
				: ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)
					? node.operand
					: null;
		const isDirectModuleStateWrite =
			isWrite && target !== null && readsModuleState(target);
		const isAllowed = !isModuleFile && isAllowedRootWrite(node, sourceFile);
		if (isDirectModuleStateWrite && !isAllowed)
			diagnostics.push(diagnostic(sourceFile, target, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
