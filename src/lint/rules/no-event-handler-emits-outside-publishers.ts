import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const SCOPED_MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)[\\/][^\\/]+\.ts$/;
const EVENT_PUBLISHERS_PATH =
	/[\\/]src[\\/](pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)[\\/]event-publishers\.ts$/;
const RULE_ID = "no-event-handler-emits-outside-publishers" as const;
const MESSAGE = "EventHandler emits must live in event-publishers.ts";

function isEventHandlerType(node: ts.Node, checker: ts.TypeChecker): boolean {
	const type = checker.getTypeAtLocation(node);
	const symbols = [type.aliasSymbol, type.symbol];
	return symbols.some((symbol) => symbol?.name === "EventHandler");
}

function isEventHandlerChannelEmit(
	node: ts.CallExpression,
	checker: ts.TypeChecker,
): boolean {
	const expression = node.expression;
	if (!ts.isPropertyAccessExpression(expression)) return false;
	if (expression.name.text !== "emit") return false;
	const channel = expression.expression;
	if (!ts.isPropertyAccessExpression(channel)) return false;
	return isEventHandlerType(channel.expression, checker);
}

export const noEventHandlerEmitsOutsidePublishers: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	if (
		!SCOPED_MODULE_PATH.test(sourceFile.fileName) ||
		EVENT_PUBLISHERS_PATH.test(sourceFile.fileName)
	)
		return;
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && isEventHandlerChannelEmit(node, checker))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
