import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const STATE_FILE_NAME = "state.ts";
const DOMAIN_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/][^\\/]+\.ts$/;
const RULE_ID = "domain-types-outside-state" as const;
const MESSAGE = "Domain interfaces and type aliases must live in state.ts";

function isTypeDeclaration(node: ts.Node): boolean {
	return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

export const noDomainTypesOutsideState: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	const isDomainFile = DOMAIN_PATH.test(sourceFile.fileName);
	const isStateFile = basename(sourceFile.fileName) === STATE_FILE_NAME;
	if (!isDomainFile || isStateFile) return;
	function visit(node: ts.Node): void {
		if (isTypeDeclaration(node))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
