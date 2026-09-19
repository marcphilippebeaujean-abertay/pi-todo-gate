import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)[\\/].+\.ts$/;
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
	"resetSessionState",
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
	let found = false;
	ts.forEachChild(node, (child) => {
		if (!found) found = readsModuleState(child);
	});
	return found;
}

const MUTATING_METHODS = new Set([
	"add",
	"clear",
	"copyWithin",
	"delete",
	"fill",
	"pop",
	"push",
	"reverse",
	"set",
	"shift",
	"sort",
	"splice",
	"unshift",
]);

function isWriteExpression(node: ts.Node): boolean {
	if (ts.isBinaryExpression(node)) return isAssignment(node);
	if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
		return (
			node.operator === ts.SyntaxKind.PlusPlusToken ||
			node.operator === ts.SyntaxKind.MinusMinusToken
		);
	if (ts.isDeleteExpression(node)) return true;
	if (!ts.isCallExpression(node)) return false;
	const callee = node.expression;
	if (
		ts.isPropertyAccessExpression(callee) &&
		MUTATING_METHODS.has(callee.name.text)
	)
		return readsModuleState(callee.expression);
	const isObjectAssign =
		ts.isPropertyAccessExpression(callee) &&
		callee.expression.getText() === "Object" &&
		callee.name.text === "assign";
	return isObjectAssign && node.arguments.some(readsModuleState);
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

function scopedModuleId(fileName: string): string | undefined {
	const normalized = fileName.replaceAll("\\", "/");
	const match = normalized.match(/\/src\/([^/]+)\//);
	const domain = match?.[1];
	if (domain === "herdr-tab-rename") return "herdrTabRename";
	return domain;
}

function publisherModuleId(node: ts.Expression): string | undefined {
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isPropertyAccessExpression(node)) return node.name.text;
	return undefined;
}

function isBoundPublisherCall(
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
): boolean {
	if (!ts.isIdentifier(node.expression)) return true;
	if (node.expression.text !== "createModuleStatePublisher") return true;
	const moduleIdArgument = node.arguments[1];
	if (moduleIdArgument === undefined) return false;
	return (
		publisherModuleId(moduleIdArgument) === scopedModuleId(sourceFile.fileName)
	);
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
					: ts.isCallExpression(node)
						? (node.arguments.find(readsModuleState) ?? node.expression)
						: null;
		const isDirectModuleStateWrite =
			isWrite && target !== null && readsModuleState(target);
		const isAllowed = !isModuleFile && isAllowedRootWrite(node, sourceFile);
		if (isDirectModuleStateWrite && !isAllowed)
			diagnostics.push(diagnostic(sourceFile, target, RULE_ID, MESSAGE, 1, 0));
		if (
			isModuleFile &&
			ts.isCallExpression(node) &&
			!isBoundPublisherCall(node, sourceFile)
		)
			diagnostics.push(
				diagnostic(sourceFile, node.expression, RULE_ID, MESSAGE, 1, 0),
			);
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
