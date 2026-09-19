import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const COMMANDS_FILE_NAME = "commands.ts";
const COMMANDS_PATH =
	/[\\/]src[\\/](?:pr|todoist|herdr-tab-rename|review|worktree|prompt-queue|footer)[\\/]commands\.ts$/;
const REGISTER_COMMAND_METHOD = "registerCommand";
const TG_PREFIX = "tg_";
const RULE_ID = "commands-require-tg-prefix" as const;
const MESSAGE = "Registered command must start with tg_";

function isCommandsFile(sourceFile: ts.SourceFile): boolean {
	return (
		basename(sourceFile.fileName) === COMMANDS_FILE_NAME &&
		COMMANDS_PATH.test(sourceFile.fileName)
	);
}

function isRegisterCommandCall(node: ts.CallExpression): boolean {
	const expression = node.expression;
	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === REGISTER_COMMAND_METHOD
	);
}

function staticCommandName(
	node: ts.Expression | undefined,
	checker: ts.TypeChecker,
): string | undefined {
	if (node === undefined) return undefined;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return node.text;
	if (!ts.isIdentifier(node)) return undefined;
	const type = checker.getTypeAtLocation(node);
	return type.isStringLiteral() ? type.value : undefined;
}

export const commandsRequireTgPrefix: LintRule = ({
	sourceFile,
	checker,
	diagnostics,
}) => {
	if (!isCommandsFile(sourceFile)) return;
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && isRegisterCommandCall(node)) {
			const commandName = staticCommandName(node.arguments[0], checker);
			if (commandName === undefined || !commandName.startsWith(TG_PREFIX))
				diagnostics.push(
					diagnostic(
						sourceFile,
						node.arguments[0] ?? node,
						RULE_ID,
						MESSAGE,
						0,
						1,
					),
				);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
