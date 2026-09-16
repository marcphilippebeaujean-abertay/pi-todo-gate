import ts from "typescript";

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
]);

export function isFunctionLike(
	node: ts.Node,
): node is ts.FunctionLikeDeclaration {
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

export function isStringLiteralLike(
	node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
	return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

export function isSingleCharacterLiteral(node: ts.Node): boolean {
	return isStringLiteralLike(node) && node.text.length <= 1;
}

export function isConstInitializer(
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

export function isPropertyName(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
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

export function isModuleSpecifier(
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

export function isTypeofComparisonString(
	node: ts.Node,
	ancestors: readonly ts.Node[],
): boolean {
	const parent = ancestors.at(-1);
	if (!parent || !ts.isBinaryExpression(parent)) return false;
	const isEquality = isEqualityOperator(parent.operatorToken.kind);
	return (
		isEquality &&
		((parent.right === node && ts.isTypeOfExpression(parent.left)) ||
			(parent.left === node && ts.isTypeOfExpression(parent.right)))
	);
}

export function isStandaloneStringStatement(
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
	const index = container.statements.indexOf(statement);
	return (
		index >= 0 &&
		container.statements
			.slice(0, index)
			.every(
				(candidate) =>
					ts.isExpressionStatement(candidate) &&
					isStringLiteralLike(candidate.expression),
			)
	);
}

export function isIgnoredString(
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

export function unparenthesized(node: ts.Expression): ts.Expression;
export function unparenthesized(node: ts.Node): ts.Node;
export function unparenthesized(node: ts.Node): ts.Node {
	let current = node;
	while (ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

export function isEqualityOperator(operator: ts.SyntaxKind): boolean {
	return (
		operator === ts.SyntaxKind.EqualsEqualsToken ||
		operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
		operator === ts.SyntaxKind.ExclamationEqualsToken ||
		operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
	);
}

export function isLogicalExpression(
	node: ts.Node,
): node is ts.BinaryExpression {
	return (
		ts.isBinaryExpression(node) &&
		LOGICAL_OPERATORS.has(node.operatorToken.kind)
	);
}

export function hasLogicalParent(ancestors: readonly ts.Node[]): boolean {
	let index = ancestors.length - 1;
	while (index >= 0 && ts.isParenthesizedExpression(ancestors[index]))
		index -= 1;
	return index >= 0 && isLogicalExpression(ancestors[index]);
}

export function logicalCheckCount(node: ts.Node): number {
	const expression = unparenthesized(node);
	if (!isLogicalExpression(expression)) return 1;
	return (
		logicalCheckCount(expression.left) + logicalCheckCount(expression.right)
	);
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
		const isEquality = isEqualityOperator(operator);
		const isNullish = (node: ts.Expression) =>
			node.kind === ts.SyntaxKind.NullKeyword ||
			(ts.isIdentifier(node) && node.text === "undefined");
		if (
			isEquality &&
			(ts.isTypeOfExpression(expression.left) ||
				ts.isTypeOfExpression(expression.right) ||
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

export function isNamedBooleanCondition(
	condition: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	while (ts.isParenthesizedExpression(condition))
		condition = condition.expression;
	if (isTypeGuardExpression(condition)) return true;
	if (ts.isPrefixUnaryExpression(condition)) {
		const isNegation = condition.operator === ts.SyntaxKind.ExclamationToken;
		return isNegation && isNamedBooleanCondition(condition.operand, checker);
	}
	return (
		ts.isIdentifier(condition) &&
		isNamedConditionType(checker.getTypeAtLocation(condition))
	);
}

export function conditionExpressions(node: ts.Node): ts.Expression[] {
	if (ts.isIfStatement(node)) return [node.expression];
	if (ts.isWhileStatement(node)) return [node.expression];
	if (ts.isDoStatement(node)) return [node.expression];
	if (ts.isConditionalExpression(node)) return [node.condition];
	return [];
}
