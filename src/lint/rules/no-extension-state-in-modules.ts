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

export const noRootStateImportsInModules: LintRule = ({
	sourceFile,
	diagnostics,
	program,
}) => {
	if (!MODULE_PATH.test(sourceFile.fileName)) return;
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const isRootState = isRootStateImport(
			sourceFile,
			statement.moduleSpecifier.text,
			program,
		);
		if (!isRootState) continue;
		const clause = statement.importClause;
		if (clause === undefined) continue;
		if (clause.name !== undefined)
			reportForbiddenBinding(sourceFile, clause.name, diagnostics);
		const namedBindings = clause.namedBindings;
		if (namedBindings === undefined) continue;
		if (ts.isNamespaceImport(namedBindings)) {
			reportForbiddenBinding(sourceFile, namedBindings.name, diagnostics);
			continue;
		}
		for (const element of namedBindings.elements) {
			const importedName = element.propertyName?.text ?? element.name.text;
			if (importedName === "SessionState") continue;
			reportForbiddenBinding(sourceFile, element.name, diagnostics);
		}
	}
};
