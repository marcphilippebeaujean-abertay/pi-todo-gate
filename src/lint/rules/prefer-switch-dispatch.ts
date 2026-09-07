import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import { isStringLiteralLike, unparenthesized } from "../shared.ts";
import type { LintRule } from "../types.ts";

interface EqualityDispatch {
	subject: string;
	caseValue: string;
}
function isDispatchLiteral(expression: ts.Expression): boolean {
	expression = unparenthesized(expression);
	return (
		isStringLiteralLike(expression) ||
		ts.isNumericLiteral(expression) ||
		expression.kind === ts.SyntaxKind.TrueKeyword ||
		expression.kind === ts.SyntaxKind.FalseKeyword ||
		expression.kind === ts.SyntaxKind.NullKeyword
	);
}
function isDispatchSubject(expression: ts.Expression): boolean {
	expression = unparenthesized(expression);
	return (
		ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)
	);
}
function equalityDispatch(
	expression: ts.Expression,
	sourceFile: ts.SourceFile,
): EqualityDispatch | null {
	expression = unparenthesized(expression);
	if (
		!ts.isBinaryExpression(expression) ||
		expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
	)
		return null;
	const left = unparenthesized(expression.left);
	const right = unparenthesized(expression.right);
	const leftIsLiteral = isDispatchLiteral(left);
	const rightIsLiteral = isDispatchLiteral(right);
	if (
		(!leftIsLiteral && !rightIsLiteral && !isDispatchSubject(left)) ||
		(leftIsLiteral && rightIsLiteral)
	)
		return null;
	const subject = leftIsLiteral ? right : left;
	const caseValue = leftIsLiteral ? left : right;
	return isDispatchSubject(subject)
		? {
				subject: subject.getText(sourceFile),
				caseValue: caseValue.getText(sourceFile),
			}
		: null;
}
function conditionAssignments(
	statement: ts.Statement,
	sourceFile: ts.SourceFile,
): { name: string; dispatch: EqualityDispatch | null }[] {
	if (ts.isVariableStatement(statement))
		return statement.declarationList.declarations.flatMap((declaration) =>
			ts.isIdentifier(declaration.name)
				? [
						{
							name: declaration.name.text,
							dispatch: declaration.initializer
								? equalityDispatch(declaration.initializer, sourceFile)
								: null,
						},
					]
				: [],
		);
	if (
		!ts.isExpressionStatement(statement) ||
		!ts.isBinaryExpression(statement.expression) ||
		statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
		!ts.isIdentifier(statement.expression.left)
	)
		return [];
	return [
		{
			name: statement.expression.left.text,
			dispatch: equalityDispatch(statement.expression.right, sourceFile),
		},
	];
}
export const preferSwitchDispatch: LintRule = ({ sourceFile, diagnostics }) => {
	function visit(node: ts.Node): void {
		if (ts.isBlock(node) || ts.isSourceFile(node)) {
			const assignments = new Map<string, EqualityDispatch>();
			const applyAssignments = (statement: ts.Statement) => {
				const entries = conditionAssignments(statement, sourceFile);
				for (const entry of entries)
					entry.dispatch
						? assignments.set(entry.name, entry.dispatch)
						: assignments.delete(entry.name);
				return entries;
			};
			const dispatchFor = (
				expression: ts.Expression,
			): EqualityDispatch | null => {
				const direct = equalityDispatch(expression, sourceFile);
				if (direct) return direct;
				const unwrapped = unparenthesized(expression);
				return ts.isIdentifier(unwrapped)
					? (assignments.get(unwrapped.text) ?? null)
					: null;
			};
			for (let index = 0; index < node.statements.length; index += 1) {
				const statement = node.statements[index];
				if (!statement) continue;
				const entries = applyAssignments(statement);
				if (
					entries.length ||
					!ts.isIfStatement(statement) ||
					statement.elseStatement
				)
					continue;
				const firstDispatch = dispatchFor(statement.expression);
				if (!firstDispatch) continue;
				const dispatches = [firstDispatch];
				let nextIndex = index + 1;
				for (; nextIndex < node.statements.length; nextIndex += 1) {
					const next = node.statements[nextIndex];
					const nextEntries = conditionAssignments(next, sourceFile);
					if (
						nextEntries.some(
							(entry) => entry.dispatch?.subject === firstDispatch.subject,
						)
					) {
						applyAssignments(next);
						continue;
					}
					if (!ts.isIfStatement(next) || next.elseStatement) break;
					const dispatch = dispatchFor(next.expression);
					if (!dispatch || dispatch.subject !== firstDispatch.subject) break;
					dispatches.push(dispatch);
				}
				const caseValues = new Set(
					dispatches.map((dispatch) => dispatch.caseValue),
				);
				if (dispatches.length > 1 && caseValues.size === dispatches.length)
					diagnostics.push(
						diagnostic(
							sourceFile,
							statement,
							"prefer-switch-dispatch",
							"Prefer switch for repeated equality dispatch on one value",
							dispatches.length,
							1,
						),
					);
				index = nextIndex - 1;
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
