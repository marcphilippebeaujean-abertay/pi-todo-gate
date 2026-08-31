import ts from "typescript";
import {
	DEFAULT_LINT_CONFIG,
	type LintConfig,
} from "./lint-config.ts";

export type LintRuleId =
	| "no-magic-strings"
	| "no-complicated-expressions"
	| "named-if-condition"
	| "cyclomatic-complexity"
	| "function-length"
	| "functions-per-file"
	| "nested-function-depth";

export interface LintDiagnostic {
	filePath: string;
	line: number;
	column: number;
	ruleId: LintRuleId;
	message: string;
	value: number;
	limit: number;
}

const MAGIC_STRING_MESSAGE = "String literal must use named constant";
const MAGIC_STRING_LIMIT = 0;
const COMPLICATED_EXPRESSION_MESSAGE = "Boolean expression has too many checks";
const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
]);

export function formatLintDiagnostic(diagnostic: LintDiagnostic): string {
	return `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.ruleId} ${diagnostic.message} (${diagnostic.value}; ${diagnostic.limit})`;
}

function compareDiagnostics(
	left: LintDiagnostic,
	right: LintDiagnostic,
): number {
	return (
		left.filePath.localeCompare(right.filePath) ||
		left.line - right.line ||
		left.column - right.column ||
		left.ruleId.localeCompare(right.ruleId)
	);
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node) ||
		ts.isConstructorDeclaration(node)
	);
}

function isStringLiteralLike(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isConstInitializer(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const declaration = ancestors.at(-1);
	if (
		!declaration ||
		!ts.isVariableDeclaration(declaration) ||
		declaration.initializer !== node
	)
		return false;
	const declarationList = ancestors.at(-2);
	return (
		declarationList !== undefined &&
		ts.isVariableDeclarationList(declarationList) &&
		(declarationList.flags & ts.NodeFlags.Const) !== 0
	);
}

function isPropertyName(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
	const parent = ancestors.at(-1);
	if (!parent) return false;
	return (
		(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
		(ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
		((ts.isPropertyAssignment(parent) ||
			ts.isMethodDeclaration(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent)) &&
			parent.name === node)
	);
}

function isModuleSpecifier(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
	const parent = ancestors.at(-1);
	if (!parent) return false;
	return (
		(ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExternalModuleReference(parent) && parent.expression === node)
	);
}

function isStandaloneStringStatement(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const parent = ancestors.at(-1);
	return Boolean(
		parent && ts.isExpressionStatement(parent) && parent.expression === node,
	);
}

function isIgnoredString(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
	return (
		isConstInitializer(node, ancestors) ||
		isPropertyName(node, ancestors) ||
		isModuleSpecifier(node, ancestors) ||
		isStandaloneStringStatement(node, ancestors)
	);
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
	return ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);
}

function unparenthesized(node: ts.Node): ts.Node {
	let current = node;
	while (ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

function hasLogicalParent(ancestors: readonly ts.Node[]): boolean {
	let index = ancestors.length - 1;
	while (index >= 0 && ts.isParenthesizedExpression(ancestors[index])) index -= 1;
	return index >= 0 && isLogicalExpression(ancestors[index]);
}

function logicalCheckCount(node: ts.Node): number {
	const expression = unparenthesized(node);
	if (!isLogicalExpression(expression)) return 1;
	return logicalCheckCount(expression.left) + logicalCheckCount(expression.right);
}

function diagnostic(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	ruleId: LintRuleId,
	message: string,
	value: number,
	limit: number,
): LintDiagnostic {
	const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	return {
		filePath: sourceFile.fileName,
		line: location.line + 1,
		column: location.character + 1,
		ruleId,
		message,
		value,
		limit,
	};
}

function collectMagicStrings(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	function visit(
		node: ts.Node,
		insideFunction: boolean,
		ancestors: readonly ts.Node[] = [],
	): void {
		const currentInsideFunction = insideFunction || isFunctionLike(node);
		if (
			currentInsideFunction &&
			isStringLiteralLike(node) &&
			!isIgnoredString(node, ancestors)
		) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					"no-magic-strings",
					MAGIC_STRING_MESSAGE,
					1,
					limit,
				),
			);
		}
		if (ts.isTypeNode(node)) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...ancestors, node]),
		);
	}
	visit(sourceFile, false);
}

function collectComplicatedExpressions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	function visit(node: ts.Node, ancestors: readonly ts.Node[] = []): void {
		if (isLogicalExpression(node) && !hasLogicalParent(ancestors)) {
			const checks = logicalCheckCount(node);
			if (checks > limit) {
				diagnostics.push(
					diagnostic(
						sourceFile,
						node,
						"no-complicated-expressions",
						COMPLICATED_EXPRESSION_MESSAGE,
						checks,
						limit,
					),
				);
			}
		}
		ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
	}
	visit(sourceFile);
}

export function lintProgram(
	program: ts.Program,
	config: Partial<LintConfig> = DEFAULT_LINT_CONFIG,
): LintDiagnostic[] {
	const resolvedConfig = { ...DEFAULT_LINT_CONFIG, ...config };
	const diagnostics: LintDiagnostic[] = [];
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.isDeclarationFile) continue;
		collectMagicStrings(sourceFile, diagnostics, MAGIC_STRING_LIMIT);
		collectComplicatedExpressions(
			sourceFile,
			diagnostics,
			resolvedConfig.maxBooleanChecks,
		);
	}
	return diagnostics.sort(compareDiagnostics);
}
