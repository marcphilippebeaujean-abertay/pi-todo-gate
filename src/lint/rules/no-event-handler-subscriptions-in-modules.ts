import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const SCOPED_MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|prompt-queue|footer)[\\/][^\\/]+\.ts$/;
const EVENT_CONSUMERS_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|prompt-queue|footer)[\\/]event-consumers\.ts$/;
const RULE_ID = "no-event-handler-subscriptions-in-modules" as const;
const MESSAGE = "EventHandler subscriptions must live in event-consumers.ts";

function isEventHandlerType(node: ts.Node, checker: ts.TypeChecker): boolean {
	const type = checker.getTypeAtLocation(node);
	const symbols = [type.aliasSymbol, type.symbol];
	return symbols.some((symbol) => symbol?.name === "EventHandler");
}

function isEventHandlerChannelSubscribe(
	node: ts.CallExpression,
	checker: ts.TypeChecker,
): boolean {
	const expression = node.expression;
	if (!ts.isPropertyAccessExpression(expression)) return false;
	if (expression.name.text !== "subscribe") return false;
	const channel = expression.expression;
	if (!ts.isPropertyAccessExpression(channel)) return false;
	return isEventHandlerType(channel.expression, checker);
}

export const noEventHandlerSubscriptionsInModules: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	if (
		!SCOPED_MODULE_PATH.test(sourceFile.fileName) ||
		EVENT_CONSUMERS_PATH.test(sourceFile.fileName)
	)
		return;
	function visit(node: ts.Node): void {
		if (
			ts.isCallExpression(node) &&
			isEventHandlerChannelSubscribe(node, checker)
		)
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
