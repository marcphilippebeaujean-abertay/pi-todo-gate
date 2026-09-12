import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/][^\\/]+\.ts$/;
const ROOT_STATE_IMPORT = /(?:^|[\\/])\.\.?[\\/]state\.ts$/;
const RULE_ID = "no-extension-state-in-modules" as const;
const MESSAGE =
	"Submodules may import SessionState from root state.ts, but not ExtensionState";

export const noExtensionStateInModules: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	if (!MODULE_PATH.test(sourceFile.fileName)) return;
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!ROOT_STATE_IMPORT.test(statement.moduleSpecifier.text)) continue;
		const clause = statement.importClause;
		const namedBindings = clause?.namedBindings;
		if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
		for (const element of namedBindings.elements) {
			if (element.name.text !== "ExtensionState") continue;
			diagnostics.push(
				diagnostic(sourceFile, element.name, RULE_ID, MESSAGE, 1, 0),
			);
		}
	}
};
