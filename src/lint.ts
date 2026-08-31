const EXTRACTED_STRING_001 = "no-magic-strings";
const EXTRACTED_STRING_002 = "named-if-condition";
const EXTRACTED_STRING_003 = "functions-per-file";
const EXTRACTED_STRING_004 = "cyclomatic-complexity";
const EXTRACTED_STRING_005 = "function-length";
const EXTRACTED_STRING_006 = "nested-function-depth";
const EXTRACTED_STRING_007 = "no-complicated-expressions";

import ts from "typescript";
import { DEFAULT_LINT_CONFIG, type LintConfig } from "./lint-config.ts";

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
const NAMED_IF_MESSAGE =
	"Extract condition into a descriptive boolean variable";
const NAMED_IF_LIMIT = 0;
const COMPLEXITY_MESSAGE = "Function exceeds cyclomatic complexity";
const FUNCTION_LENGTH_MESSAGE = "Function exceeds maximum length";
const FUNCTIONS_PER_FILE_MESSAGE = "File contains too many functions";
const NESTED_FUNCTION_MESSAGE = "Function is nested too deeply";
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

function isStringLiteralLike(
	node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isConstInitializer(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const declaration = ancestors.at(-1);
	const EXTRACTED_CONDITION_117: boolean = Boolean(
		!declaration ||
			!ts.isVariableDeclaration(declaration) ||
			declaration.initializer !== node,
	);
	if (EXTRACTED_CONDITION_117) return false;
	const declarationList = ancestors.at(-2);
	return (
		declarationList !== undefined &&
		ts.isVariableDeclarationList(declarationList) &&
		(declarationList.flags & ts.NodeFlags.Const) !== 0
	);
}

function isPropertyName(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
	const parent = ancestors.at(-1);
	const EXTRACTED_CONDITION_118: boolean = Boolean(!parent);
	if (EXTRACTED_CONDITION_118) return false;
	return (
		(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
		(ts.isElementAccessExpression(parent) &&
			parent.argumentExpression === node) ||
		((ts.isPropertyAssignment(parent) ||
			ts.isMethodDeclaration(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent)) &&
			parent.name === node)
	);
}

function isModuleSpecifier(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const parent = ancestors.at(-1);
	const EXTRACTED_CONDITION_119: boolean = Boolean(!parent);
	if (EXTRACTED_CONDITION_119) return false;
	return (
		(ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExternalModuleReference(parent) && parent.expression === node)
	);
}

function isTypeofComparisonString(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const parent = ancestors.at(-1);
	const EXTRACTED_CONDITION_120: boolean = Boolean(
		!parent || !ts.isBinaryExpression(parent),
	);
	if (EXTRACTED_CONDITION_120) return false;
	const isEquality =
		parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
	if (!isEquality) return false;
	return (
		(parent.right === node && ts.isTypeOfExpression(parent.left)) ||
		(parent.left === node && ts.isTypeOfExpression(parent.right))
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

function isIgnoredString(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	return (
		isConstInitializer(node, ancestors) ||
		isPropertyName(node, ancestors) ||
		isModuleSpecifier(node, ancestors) ||
		isTypeofComparisonString(node, ancestors) ||
		isStandaloneStringStatement(node, ancestors)
	);
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
	return (
		ts.isBinaryExpression(node) &&
		LOGICAL_OPERATORS.has(node.operatorToken.kind)
	);
}

function unparenthesized(node: ts.Node): ts.Node {
	let current = node;
	while (ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

function hasLogicalParent(ancestors: readonly ts.Node[]): boolean {
	let index = ancestors.length - 1;
	while (index >= 0 && ts.isParenthesizedExpression(ancestors[index]))
		index -= 1;
	return index >= 0 && isLogicalExpression(ancestors[index]);
}

function logicalCheckCount(node: ts.Node): number {
	const expression = unparenthesized(node);
	const EXTRACTED_CONDITION_121: boolean = Boolean(
		!isLogicalExpression(expression),
	);
	if (EXTRACTED_CONDITION_121) return 1;
	return (
		logicalCheckCount(expression.left) + logicalCheckCount(expression.right)
	);
}

function diagnostic(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	ruleId: LintRuleId,
	message: string,
	value: number,
	limit: number,
): LintDiagnostic {
	const location = sourceFile.getLineAndCharacterOfPosition(
		node.getStart(sourceFile),
	);
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
		const EXTRACTED_CONDITION_122: boolean = Boolean(
			currentInsideFunction &&
				isStringLiteralLike(node) &&
				!isIgnoredString(node, ancestors),
		);
		if (EXTRACTED_CONDITION_122) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					EXTRACTED_STRING_001,
					MAGIC_STRING_MESSAGE,
					1,
					limit,
				),
			);
		}
		const EXTRACTED_CONDITION_123: boolean = Boolean(ts.isTypeNode(node));
		if (EXTRACTED_CONDITION_123) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...ancestors, node]),
		);
	}
	visit(sourceFile, false);
}

function isBooleanType(type: ts.Type): boolean {
	const EXTRACTED_CONDITION_124: boolean = Boolean(
		(type.flags & ts.TypeFlags.BooleanLike) !== 0,
	);
	if (EXTRACTED_CONDITION_124) return true;
	return type.isUnion() && type.types.every(isBooleanType);
}

function isNamedBooleanCondition(
	condition: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	let expression = condition;
	while (ts.isParenthesizedExpression(expression))
		expression = expression.expression;
	const EXTRACTED_CONDITION_125: boolean = Boolean(
		ts.isPrefixUnaryExpression(expression),
	);
	if (EXTRACTED_CONDITION_125) {
		const EXTRACTED_CONDITION_126: boolean = Boolean(
			expression.operator !== ts.SyntaxKind.ExclamationToken,
		);
		if (EXTRACTED_CONDITION_126) return false;
		expression = expression.operand;
		while (ts.isParenthesizedExpression(expression))
			expression = expression.expression;
	}
	return (
		ts.isIdentifier(expression) &&
		isBooleanType(checker.getTypeAtLocation(expression))
	);
}

function collectNamedIfConditions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	checker: ts.TypeChecker,
): void {
	function visit(node: ts.Node): void {
		const EXTRACTED_CONDITION_127: boolean = Boolean(
			ts.isIfStatement(node) &&
				!isNamedBooleanCondition(node.expression, checker),
		);
		if (EXTRACTED_CONDITION_127) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node.expression,
					EXTRACTED_STRING_002,
					NAMED_IF_MESSAGE,
					1,
					NAMED_IF_LIMIT,
				),
			);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
}

function functionComplexity(body: ts.Node): number {
	let complexity = 1;
	function visit(node: ts.Node): void {
		const EXTRACTED_CONDITION_128: boolean = Boolean(
			node !== body && isFunctionLike(node),
		);
		if (EXTRACTED_CONDITION_128) return;
		const EXTRACTED_CONDITION_129: boolean = Boolean(
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
					node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken),
		);
		if (EXTRACTED_CONDITION_129) {
			complexity += 1;
		}
		ts.forEachChild(node, visit);
	}
	visit(body);
	return complexity;
}

interface FunctionMetric {
	node: ts.FunctionLikeDeclaration;
	depth: number;
	complexity: number;
	lines: number;
}

function collectFunctionMetrics(sourceFile: ts.SourceFile): FunctionMetric[] {
	const metrics: FunctionMetric[] = [];
	function visit(node: ts.Node, containingFunctionDepth: number): void {
		const EXTRACTED_CONDITION_130: boolean = Boolean(isFunctionLike(node));
		if (EXTRACTED_CONDITION_130) {
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

function collectFunctionDiagnostics(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	config: LintConfig,
): void {
	const metrics = collectFunctionMetrics(sourceFile);
	const EXTRACTED_CONDITION_131: boolean = Boolean(
		metrics.length > config.maxFunctionsPerFile,
	);
	if (EXTRACTED_CONDITION_131) {
		diagnostics.push(
			diagnostic(
				sourceFile,
				sourceFile,
				EXTRACTED_STRING_003,
				FUNCTIONS_PER_FILE_MESSAGE,
				metrics.length,
				config.maxFunctionsPerFile,
			),
		);
	}
	for (const metric of metrics) {
		const EXTRACTED_CONDITION_132: boolean = Boolean(
			metric.complexity > config.maxCyclomaticComplexity,
		);
		if (EXTRACTED_CONDITION_132) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					EXTRACTED_STRING_004,
					COMPLEXITY_MESSAGE,
					metric.complexity,
					config.maxCyclomaticComplexity,
				),
			);
		}
		const EXTRACTED_CONDITION_133: boolean = Boolean(
			metric.lines > config.maxFunctionLines,
		);
		if (EXTRACTED_CONDITION_133) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					EXTRACTED_STRING_005,
					FUNCTION_LENGTH_MESSAGE,
					metric.lines,
					config.maxFunctionLines,
				),
			);
		}
		const EXTRACTED_CONDITION_134: boolean = Boolean(
			metric.depth > config.maxNestedFunctionDepth,
		);
		if (EXTRACTED_CONDITION_134) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					EXTRACTED_STRING_006,
					NESTED_FUNCTION_MESSAGE,
					metric.depth,
					config.maxNestedFunctionDepth,
				),
			);
		}
	}
}

function collectComplicatedExpressions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	function visit(node: ts.Node, ancestors: readonly ts.Node[] = []): void {
		const EXTRACTED_CONDITION_135: boolean = Boolean(
			isLogicalExpression(node) && !hasLogicalParent(ancestors),
		);
		if (EXTRACTED_CONDITION_135) {
			const checks = logicalCheckCount(node);
			const EXTRACTED_CONDITION_136: boolean = Boolean(checks > limit);
			if (EXTRACTED_CONDITION_136) {
				diagnostics.push(
					diagnostic(
						sourceFile,
						node,
						EXTRACTED_STRING_007,
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
	const checker = program.getTypeChecker();
	for (const sourceFile of program.getSourceFiles()) {
		const EXTRACTED_CONDITION_137: boolean = Boolean(
			sourceFile.isDeclarationFile,
		);
		if (EXTRACTED_CONDITION_137) continue;
		collectMagicStrings(sourceFile, diagnostics, MAGIC_STRING_LIMIT);
		collectNamedIfConditions(sourceFile, diagnostics, checker);
		collectComplicatedExpressions(
			sourceFile,
			diagnostics,
			resolvedConfig.maxBooleanChecks,
		);
		collectFunctionDiagnostics(sourceFile, diagnostics, resolvedConfig);
	}
	return diagnostics.sort(compareDiagnostics);
}
