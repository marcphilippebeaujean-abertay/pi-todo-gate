const NO_MAGIC_STRINGS = "no-magic-strings";
const NAMED_IF_CONDITION = "named-if-condition";
const FUNCTIONS_PER_FILE = "functions-per-file";
const CYCLOMATIC_COMPLEXITY = "cyclomatic-complexity";
const FUNCTION_LENGTH = "function-length";
const NESTED_FUNCTION_DEPTH = "nested-function-depth";
const NO_COMPLICATED_EXPRESSIONS = "no-complicated-expressions";

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

function isSingleCharacterLiteral(node: ts.Node): boolean {
	return isStringLiteralLike(node) && node.text.length <= 1;
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
	const grandparent = ancestors.at(-2);
	if (!parent) return false;
	const isDynamicImport =
		ts.isCallExpression(parent) &&
		parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
		parent.arguments[0] === node;
	return (
		(ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
		(ts.isExternalModuleReference(parent) && parent.expression === node) ||
		isDynamicImport ||
		(ts.isLiteralTypeNode(parent) &&
			grandparent !== undefined &&
			ts.isImportTypeNode(grandparent) &&
			parent.literal === node)
	);
}

function isTypeofComparisonString(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const parent = ancestors.at(-1);
	if (!parent || !ts.isBinaryExpression(parent)) return false;
	const isEquality =
		parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
		parent.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
	if (!isEquality) return false;
	const other = parent.left === node ? parent.right : parent.left;
	return (
		(parent.right === node && ts.isTypeOfExpression(parent.left)) ||
		(parent.left === node && ts.isTypeOfExpression(parent.right)) ||
		ts.isPropertyAccessExpression(other) ||
		ts.isElementAccessExpression(other)
	);
}

function isStandaloneStringStatement(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const statement = ancestors.at(-1);
	const container = ancestors.at(-2);
	if (
		!statement ||
		!container ||
		!ts.isExpressionStatement(statement) ||
		statement.expression !== node ||
		(!ts.isBlock(container) && !ts.isSourceFile(container))
	)
		return false;
	const statements = container.statements;
	const index = statements.indexOf(statement);
	return (
		index >= 0 &&
		statements
			.slice(0, index)
			.every(
				(candidate) =>
					ts.isExpressionStatement(candidate) &&
					isStringLiteralLike(candidate.expression),
			)
	);
}

function isIgnoredString(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	return (
		isSingleCharacterLiteral(node) ||
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
	if (!isLogicalExpression(expression)) return 1;
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
		if (
			currentInsideFunction &&
			isStringLiteralLike(node) &&
			!isIgnoredString(node, ancestors)
		) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					NO_MAGIC_STRINGS,
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

function isNamedConditionType(type: ts.Type): boolean {
	const isBooleanLike = (type.flags & ts.TypeFlags.BooleanLike) !== 0;
	if (isBooleanLike) return true;
	if (!type.isUnion()) return false;
	const nonNullishTypes = type.types.filter(
		(member) =>
			(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0,
	);
	return (
		nonNullishTypes.length > 0 && nonNullishTypes.every(isNamedConditionType)
	);
}

function isTypeGuardExpression(expression: ts.Expression): boolean {
	while (ts.isParenthesizedExpression(expression))
		expression = expression.expression;
	if (ts.isPrefixUnaryExpression(expression)) {
		return (
			expression.operator === ts.SyntaxKind.ExclamationToken &&
			isTypeGuardExpression(expression.operand)
		);
	}
	if (ts.isBinaryExpression(expression)) {
		const operator = expression.operatorToken.kind;
		const isEquality =
			operator === ts.SyntaxKind.EqualsEqualsToken ||
			operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
			operator === ts.SyntaxKind.ExclamationEqualsToken ||
			operator === ts.SyntaxKind.ExclamationEqualsEqualsToken;
		const isNullish = (node: ts.Expression) =>
			node.kind === ts.SyntaxKind.NullKeyword ||
			(ts.isIdentifier(node) && node.text === "undefined");
		if (
			isEquality &&
			(isTypeOfExpression(expression.left) ||
				isTypeOfExpression(expression.right) ||
				isNullish(expression.left) ||
				isNullish(expression.right))
		)
			return true;
		if (
			operator === ts.SyntaxKind.InKeyword ||
			operator === ts.SyntaxKind.InstanceOfKeyword
		)
			return true;
	}
	return (
		ts.isCallExpression(expression) &&
		ts.isPropertyAccessExpression(expression.expression) &&
		ts.isIdentifier(expression.expression.expression) &&
		expression.expression.expression.text === "Array" &&
		expression.expression.name.text === "isArray"
	);
}

function isTypeOfExpression(node: ts.Expression): boolean {
	return ts.isTypeOfExpression(node);
}

function isNarrowingComparison(expression: ts.Expression): boolean {
	if (!ts.isBinaryExpression(expression)) return false;
	const operators = new Set<ts.SyntaxKind>([
		ts.SyntaxKind.EqualsEqualsToken,
		ts.SyntaxKind.EqualsEqualsEqualsToken,
		ts.SyntaxKind.ExclamationEqualsToken,
		ts.SyntaxKind.ExclamationEqualsEqualsToken,
	]);
	if (!operators.has(expression.operatorToken.kind)) return false;
	return (
		ts.isPropertyAccessExpression(expression.left) ||
		ts.isElementAccessExpression(expression.left) ||
		ts.isPropertyAccessExpression(expression.right) ||
		ts.isElementAccessExpression(expression.right)
	);
}

function isSafeConditionExpression(
	expression: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	while (ts.isParenthesizedExpression(expression))
		expression = expression.expression;
	if (isTypeGuardExpression(expression) || isNarrowingComparison(expression))
		return true;
	if (isNullableIdentifier(expression, checker)) return true;
	if (
		ts.isIdentifier(expression) &&
		isNamedConditionType(checker.getTypeAtLocation(expression))
	)
		return true;
	if (
		ts.isCallExpression(expression) ||
		ts.isPropertyAccessExpression(expression) ||
		ts.isElementAccessExpression(expression)
	)
		return true;
	if (ts.isPrefixUnaryExpression(expression))
		return (
			expression.operator === ts.SyntaxKind.ExclamationToken &&
			isSafeConditionExpression(expression.operand, checker)
		);
	if (!ts.isBinaryExpression(expression)) return false;
	if (
		expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
		expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
	)
		return (
			isSafeConditionExpression(expression.left, checker) &&
			isSafeConditionExpression(expression.right, checker)
		);
	const hasPropertyOrCall =
		ts.isCallExpression(expression.left) ||
		ts.isCallExpression(expression.right) ||
		ts.isPropertyAccessExpression(expression.left) ||
		ts.isPropertyAccessExpression(expression.right) ||
		ts.isElementAccessExpression(expression.left) ||
		ts.isElementAccessExpression(expression.right);
	if (hasPropertyOrCall) return true;
	const equalityOperators = new Set<ts.SyntaxKind>([
		ts.SyntaxKind.EqualsEqualsToken,
		ts.SyntaxKind.EqualsEqualsEqualsToken,
		ts.SyntaxKind.ExclamationEqualsToken,
		ts.SyntaxKind.ExclamationEqualsEqualsToken,
	]);
	const leftIsIdentifier = ts.isIdentifier(expression.left);
	const rightIsIdentifier = ts.isIdentifier(expression.right);
	const hasLiteral =
		ts.isStringLiteralLike(expression.left) ||
		ts.isNumericLiteral(expression.left) ||
		expression.left.kind === ts.SyntaxKind.NullKeyword ||
		(ts.isIdentifier(expression.left) &&
			expression.left.text === "undefined") ||
		ts.isStringLiteralLike(expression.right) ||
		ts.isNumericLiteral(expression.right) ||
		expression.right.kind === ts.SyntaxKind.NullKeyword ||
		(ts.isIdentifier(expression.right) &&
			expression.right.text === "undefined");
	return (
		(leftIsIdentifier &&
			rightIsIdentifier &&
			(equalityOperators.has(expression.operatorToken.kind) || !hasLiteral)) ||
		(equalityOperators.has(expression.operatorToken.kind) &&
			hasLiteral &&
			(leftIsIdentifier || rightIsIdentifier))
	);
}

function isNullableIdentifier(
	expression: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	if (!ts.isIdentifier(expression)) return false;
	const type = checker.getTypeAtLocation(expression);
	if ((type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0)
		return true;
	return (
		type.isUnion() &&
		type.types.some(
			(member) =>
				(member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0,
		)
	);
}

function isNamedBooleanCondition(
	condition: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	if (isSafeConditionExpression(condition, checker)) return true;
	if (isLogicalExpression(condition)) return true;
	let expression = condition;
	while (ts.isParenthesizedExpression(expression))
		expression = expression.expression;
	if (ts.isPrefixUnaryExpression(expression)) {
		if (expression.operator !== ts.SyntaxKind.ExclamationToken) return false;
		expression = expression.operand;
		while (ts.isParenthesizedExpression(expression))
			expression = expression.expression;
	}
	if (isNullableIdentifier(expression, checker)) return true;
	if (ts.isIdentifier(expression))
		return isNamedConditionType(checker.getTypeAtLocation(expression));
	return (
		ts.isIdentifier(expression) &&
		isNamedConditionType(checker.getTypeAtLocation(expression))
	);
}

function collectNamedIfConditions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	checker: ts.TypeChecker,
): void {
	function visit(node: ts.Node): void {
		if (
			ts.isIfStatement(node) &&
			!isNamedBooleanCondition(node.expression, checker)
		) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node.expression,
					NAMED_IF_CONDITION,
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
		) {
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

function collectFunctionDiagnostics(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	config: LintConfig,
): void {
	const metrics = collectFunctionMetrics(sourceFile);
	if (metrics.length > config.maxFunctionsPerFile) {
		diagnostics.push(
			diagnostic(
				sourceFile,
				sourceFile,
				FUNCTIONS_PER_FILE,
				FUNCTIONS_PER_FILE_MESSAGE,
				metrics.length,
				config.maxFunctionsPerFile,
			),
		);
	}
	for (const metric of metrics) {
		if (metric.complexity > config.maxCyclomaticComplexity) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					CYCLOMATIC_COMPLEXITY,
					COMPLEXITY_MESSAGE,
					metric.complexity,
					config.maxCyclomaticComplexity,
				),
			);
		}
		if (metric.lines > config.maxFunctionLines) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					FUNCTION_LENGTH,
					FUNCTION_LENGTH_MESSAGE,
					metric.lines,
					config.maxFunctionLines,
				),
			);
		}
		if (metric.depth > config.maxNestedFunctionDepth) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					metric.node,
					NESTED_FUNCTION_DEPTH,
					NESTED_FUNCTION_MESSAGE,
					metric.depth,
					config.maxNestedFunctionDepth,
				),
			);
		}
	}
}

function isIfCondition(node: ts.Node, ancestors: readonly ts.Node[]): boolean {
	const parent = ancestors.at(-1);
	return (
		parent !== undefined &&
		ts.isIfStatement(parent) &&
		parent.expression === node
	);
}

function collectComplicatedExpressions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	function visit(node: ts.Node, ancestors: readonly ts.Node[] = []): void {
		if (
			isLogicalExpression(node) &&
			!hasLogicalParent(ancestors) &&
			!isIfCondition(node, ancestors)
		) {
			const checks = logicalCheckCount(node);
			if (checks > limit) {
				diagnostics.push(
					diagnostic(
						sourceFile,
						node,
						NO_COMPLICATED_EXPRESSIONS,
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
		if (sourceFile.isDeclarationFile) continue;
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
