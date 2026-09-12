import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const COMMANDS_FILE_NAME = "commands.ts";
const COMMANDS_PATH =
	/[\\/]src[\\/](?:pr|todoist|herdr|worktree|exit-protocol|footer)[\\/]commands\.ts$/;
const RULE_ID = "commands-only-register" as const;
const MESSAGE = "commands.ts may export only register";

function isCommandsFile(sourceFile: ts.SourceFile): boolean {
	return (
		basename(sourceFile.fileName) === COMMANDS_FILE_NAME &&
		COMMANDS_PATH.test(sourceFile.fileName)
	);
}

function isExported(node: ts.Node): boolean {
	return (
		(ts.getCombinedModifierFlags(node as ts.Declaration) &
			ts.ModifierFlags.Export) !==
		0
	);
}

function isNamedDeclaration(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isInterfaceDeclaration(node) ||
		ts.isTypeAliasDeclaration(node) ||
		ts.isEnumDeclaration(node)
	);
}

function isTopLevelVariable(node: ts.Node): node is ts.VariableDeclaration {
	return (
		ts.isVariableDeclaration(node) &&
		ts.isVariableStatement(node.parent.parent) &&
		ts.isSourceFile(node.parent.parent.parent)
	);
}

function isExportedVariable(node: ts.VariableDeclaration): boolean {
	return isExported(node.parent.parent);
}

function isRegisterFunction(node: ts.Node): boolean {
	return ts.isFunctionDeclaration(node) && node.name?.text === "register";
}

function isAllowedRegister(node: ts.Node): boolean {
	return isRegisterFunction(node) && isExported(node);
}

function isAllowedExportSpecifier(
	specifier: ts.ExportSpecifier,
	checker: ts.TypeChecker,
): boolean {
	if (specifier.isTypeOnly) return false;
	const exportedName = specifier.name.text;
	if (exportedName !== "register") return false;
	const localName = specifier.propertyName ?? specifier.name;
	const symbol = checker.getSymbolAtLocation(localName);
	return symbol?.declarations?.some(isRegisterFunction) ?? false;
}

export const commandsOnlyRegister: LintRule = ({
	sourceFile,
	checker,
	diagnostics,
}) => {
	if (!isCommandsFile(sourceFile)) return;
	function visit(node: ts.Node): void {
		const isExportedDeclaration =
			(isNamedDeclaration(node) && isExported(node)) ||
			(isTopLevelVariable(node) && isExportedVariable(node));
		if (isExportedDeclaration && !isAllowedRegister(node))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		if (ts.isExportDeclaration(node)) {
			const clause = node.exportClause;
			if (clause === undefined || ts.isNamespaceExport(clause))
				diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
			else
				for (const specifier of clause.elements)
					if (!isAllowedExportSpecifier(specifier, checker))
						diagnostics.push(
							diagnostic(sourceFile, specifier, RULE_ID, MESSAGE, 1, 0),
						);
		}
		if (ts.isExportAssignment(node))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
