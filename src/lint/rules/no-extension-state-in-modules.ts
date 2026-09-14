import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/].+\.ts$/;
const ROOT_STATE_PATH = /[\\/]src[\\/]state\.ts$/;
const RULE_ID = "no-root-state-imports-in-modules" as const;
const MESSAGE =
	"Scoped modules may import only SessionState from root state.ts";

function isRootStateImport(
	sourceFile: ts.SourceFile,
	moduleSpecifier: string,
	program: ts.Program,
): boolean {
	const resolvedModule = ts.resolveModuleName(
		moduleSpecifier,
		sourceFile.fileName,
		program.getCompilerOptions(),
		ts.sys,
	).resolvedModule;
	if (resolvedModule === undefined) return false;
	const resolvedPath = resolvedModule.resolvedFileName.replaceAll("\\", "/");
	return ROOT_STATE_PATH.test(resolvedPath);
}

function reportForbiddenBinding(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
}

function checkImportDeclaration(
	sourceFile: ts.SourceFile,
	statement: ts.ImportDeclaration,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	const clause = statement.importClause;
	if (clause === undefined) return;
	if (clause.name !== undefined)
		reportForbiddenBinding(sourceFile, clause.name, diagnostics);
	const namedBindings = clause.namedBindings;
	if (namedBindings === undefined) return;
	if (ts.isNamespaceImport(namedBindings)) {
		reportForbiddenBinding(sourceFile, namedBindings.name, diagnostics);
		return;
	}
	for (const element of namedBindings.elements) {
		const importedName = element.propertyName?.text ?? element.name.text;
		if (importedName === "SessionState") continue;
		reportForbiddenBinding(sourceFile, element.name, diagnostics);
	}
}

function checkExportDeclaration(
	sourceFile: ts.SourceFile,
	statement: ts.ExportDeclaration,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	const moduleSpecifier = statement.moduleSpecifier;
	if (moduleSpecifier === undefined) return;
	if (!ts.isStringLiteral(moduleSpecifier)) return;
	const clause = statement.exportClause;
	if (clause === undefined) {
		reportForbiddenBinding(sourceFile, moduleSpecifier, diagnostics);
		return;
	}
	if (ts.isNamespaceExport(clause)) {
		reportForbiddenBinding(sourceFile, clause.name, diagnostics);
		return;
	}
	for (const element of clause.elements) {
		const exportedName = element.propertyName?.text ?? element.name.text;
		if (exportedName === "SessionState") continue;
		reportForbiddenBinding(sourceFile, element.name, diagnostics);
	}
}

export const noRootStateImportsInModules: LintRule = ({
	sourceFile,
	diagnostics,
	program,
}) => {
	if (!MODULE_PATH.test(sourceFile.fileName)) return;
	for (const statement of sourceFile.statements) {
		const isImport = ts.isImportDeclaration(statement);
		const isExport = ts.isExportDeclaration(statement);
		if (!isImport && !isExport) continue;
		const moduleSpecifier = statement.moduleSpecifier;
		if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier))
			continue;
		const isRootState = isRootStateImport(
			sourceFile,
			moduleSpecifier.text,
			program,
		);
		if (!isRootState) continue;
		if (isImport) checkImportDeclaration(sourceFile, statement, diagnostics);
		else checkExportDeclaration(sourceFile, statement, diagnostics);
	}
};
