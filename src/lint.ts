const NO_MAGIC_STRINGS = "no-magic-strings";
const NO_SHORT_STRING_CONSTANTS = "no-short-string-constants";
const SIMILAR_STRING_LITERALS = "similar-string-literals";
const NAMED_IF_CONDITION = "named-if-condition";
const FUNCTIONS_PER_FILE = "functions-per-file";
const CYCLOMATIC_COMPLEXITY = "cyclomatic-complexity";
const FUNCTION_LENGTH = "function-length";
const NESTED_FUNCTION_DEPTH = "nested-function-depth";
const NO_COMPLICATED_EXPRESSIONS = "no-complicated-expressions";

import ts from "typescript";
import { DEFAULT_LINT_CONFIG, type LintConfig } from "./lint-config.ts";
import { normalizedPath } from "./shared/path.ts";

export type LintRuleId =
	| "no-magic-strings"
	| "no-short-string-constants"
	| "similar-string-literals"
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
const SIMILAR_STRING_MESSAGE =
	"Similar string literals should share parameterized function";
const SIMILAR_STRING_LIMIT = 80;
const MIN_SIMILAR_STRING_LENGTH = 12;
const SHORT_STRING_CONSTANT_MESSAGE =
	"String constants must contain at least two characters";
const SHORT_STRING_CONSTANT_LIMIT = 1;
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
		normalizedPath(left.filePath).localeCompare(
			normalizedPath(right.filePath),
		) ||
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
	return (
		(parent.right === node && ts.isTypeOfExpression(parent.left)) ||
		(parent.left === node && ts.isTypeOfExpression(parent.right))
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

interface StringLiteralOccurrence {
	node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
	text: string;
}

function normalizedString(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitutionCost =
				left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + substitutionCost,
			);
		}
		previous = current;
	}
	return previous[right.length];
}

function stringSimilarityPercent(left: string, right: string): number {
	const normalizedLeft = normalizedString(left);
	const normalizedRight = normalizedString(right);
	const combinedLength = normalizedLeft.length + normalizedRight.length;
	if (combinedLength === 0) return 100;
	return (
		(1 - editDistance(normalizedLeft, normalizedRight) / combinedLength) * 100
	);
}

function collectStringLiteralOccurrences(
	sourceFile: ts.SourceFile,
): StringLiteralOccurrence[] {
	const occurrences: StringLiteralOccurrence[] = [];
	function visit(
		node: ts.Node,
		insideFunction: boolean,
		ancestors: readonly ts.Node[] = [],
	): void {
		const currentInsideFunction = insideFunction || isFunctionLike(node);
		if (
			currentInsideFunction &&
			isStringLiteralLike(node) &&
			node.text.length >= MIN_SIMILAR_STRING_LENGTH &&
			!isIgnoredString(node, ancestors)
		) {
			occurrences.push({ node, text: node.text });
		}
		if (ts.isTypeNode(node)) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...ancestors, node]),
		);
	}
	visit(sourceFile, false);
	return occurrences;
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

function collectShortStringConstants(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
): void {
	function visit(node: ts.Node, ancestors: readonly ts.Node[] = []): void {
		if (isSingleCharacterLiteral(node) && isConstInitializer(node, ancestors)) {
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					NO_SHORT_STRING_CONSTANTS,
					SHORT_STRING_CONSTANT_MESSAGE,
					isStringLiteralLike(node) ? node.text.length : 0,
					SHORT_STRING_CONSTANT_LIMIT,
				),
			);
		}
		ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
	}
	visit(sourceFile);
}

function collectSimilarStringLiterals(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
): void {
	const occurrences = collectStringLiteralOccurrences(sourceFile);
	const counts = new Map<string, number>();
	for (const occurrence of occurrences) {
		counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
	}
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
			if (similarity < SIMILAR_STRING_LIMIT) continue;
			matches.set(left.node, Math.max(matches.get(left.node) ?? 0, similarity));
			matches.set(
				right.node,
				Math.max(matches.get(right.node) ?? 0, similarity),
			);
		}
	}
	for (const occurrence of singletons) {
		const similarity = matches.get(occurrence.node);
		if (similarity === undefined) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				occurrence.node,
				SIMILAR_STRING_LITERALS,
				SIMILAR_STRING_MESSAGE,
				Math.round(similarity),
				SIMILAR_STRING_LIMIT,
			),
		);
	}
}

function collectMagicStrings(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	const occurrences: StringLiteralOccurrence[] = [];
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
			occurrences.push({ node, text: node.text });
		}
		if (ts.isTypeNode(node)) return;
		ts.forEachChild(node, (child) =>
			visit(child, currentInsideFunction, [...ancestors, node]),
		);
	}
	visit(sourceFile, false);

	const counts = new Map<string, number>();
	for (const occurrence of occurrences) {
		counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
	}
	for (const occurrence of occurrences) {
		if (counts.get(occurrence.text) === 1) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				occurrence.node,
				NO_MAGIC_STRINGS,
				MAGIC_STRING_MESSAGE,
				counts.get(occurrence.text) ?? 0,
				limit,
			),
		);
	}
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

function isSafeConditionExpression(
	expression: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	while (ts.isParenthesizedExpression(expression))
		expression = expression.expression;
	if (isTypeGuardExpression(expression)) return true;
	if (ts.isPrefixUnaryExpression(expression)) {
		const isNegation = expression.operator === ts.SyntaxKind.ExclamationToken;
		return isNegation && isSafeConditionExpression(expression.operand, checker);
	}
	return (
		ts.isIdentifier(expression) &&
		isNamedConditionType(checker.getTypeAtLocation(expression))
	);
}

function isNamedBooleanCondition(
	condition: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	return isSafeConditionExpression(condition, checker);
}

function conditionExpressions(node: ts.Node): ts.Expression[] {
	if (ts.isIfStatement(node)) return [node.expression];
	if (ts.isWhileStatement(node)) return [node.expression];
	if (ts.isDoStatement(node)) return [node.expression];
	if (ts.isConditionalExpression(node)) return [node.condition];
	return [];
}

function collectNamedIfConditions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	checker: ts.TypeChecker,
): void {
	function visit(node: ts.Node): void {
		for (const expression of conditionExpressions(node)) {
			if (isNamedBooleanCondition(expression, checker)) continue;
			diagnostics.push(
				diagnostic(
					sourceFile,
					expression,
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

function collectComplicatedExpressions(
	sourceFile: ts.SourceFile,
	diagnostics: LintDiagnostic[],
	limit: number,
): void {
	function visit(node: ts.Node, ancestors: readonly ts.Node[] = []): void {
		const isOutermostLogicalExpression =
			isLogicalExpression(node) && !hasLogicalParent(ancestors);
		if (isOutermostLogicalExpression) {
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
	lintRoots?: readonly string[],
): LintDiagnostic[] {
	const resolvedConfig = { ...DEFAULT_LINT_CONFIG, ...config };
	const diagnostics: LintDiagnostic[] = [];
	const checker = program.getTypeChecker();
	const explicitRoots = lintRoots
		? new Set(lintRoots.map((filePath) => ts.sys.resolvePath(filePath)))
		: undefined;
	for (const sourceFile of program.getSourceFiles()) {
		if (
			sourceFile.isDeclarationFile ||
			(explicitRoots !== undefined &&
				!explicitRoots.has(ts.sys.resolvePath(sourceFile.fileName)))
		)
			continue;
		collectShortStringConstants(sourceFile, diagnostics);
		collectMagicStrings(sourceFile, diagnostics, MAGIC_STRING_LIMIT);
		collectSimilarStringLiterals(sourceFile, diagnostics);
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
