import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

function isNamedConditionType(type: ts.Type): boolean {
	if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) return true;
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
	if (ts.isPrefixUnaryExpression(expression))
		return (
			expression.operator === ts.SyntaxKind.ExclamationToken &&
			isTypeGuardExpression(expression.operand)
		);
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
function isNamedBooleanCondition(
	condition: ts.Expression,
	checker: ts.TypeChecker,
): boolean {
	while (ts.isParenthesizedExpression(condition))
		condition = condition.expression;
	if (isTypeGuardExpression(condition)) return true;
	if (ts.isPrefixUnaryExpression(condition))
		return (
			condition.operator === ts.SyntaxKind.ExclamationToken &&
			isNamedBooleanCondition(condition.operand, checker)
		);
	return (
		ts.isIdentifier(condition) &&
		isNamedConditionType(checker.getTypeAtLocation(condition))
	);
}
function conditionExpressions(node: ts.Node): ts.Expression[] {
	if (
		ts.isIfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node)
	)
		return [node.expression];
	if (ts.isConditionalExpression(node)) return [node.condition];
	return [];
}
export const namedIfCondition: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	const isRootCoordinator = /[\\/]src[\\/](event-consumer|main)\.ts$/.test(
		sourceFile.fileName,
	);
	if (isRootCoordinator) return;
	function visit(node: ts.Node): void {
		for (const expression of conditionExpressions(node))
			if (!isNamedBooleanCondition(expression, checker))
				diagnostics.push(
					diagnostic(
						sourceFile,
						expression,
						"named-if-condition",
						"Extract condition into a descriptive boolean variable",
						1,
						0,
					),
				);
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
