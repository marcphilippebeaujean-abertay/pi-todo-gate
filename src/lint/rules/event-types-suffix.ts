import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const EVENTS_FILE_NAME = "events.ts";
const EVENTS_PATH = /[\\/]src[\\/](?:[^\\/]+[\\/])*events\.ts$/;
const RULE_ID = "event-types-suffix" as const;
const MESSAGE = "Types and data in events.ts must end with Event";

function isEventsFile(sourceFile: ts.SourceFile): boolean {
	return (
		basename(sourceFile.fileName) === EVENTS_FILE_NAME &&
		EVENTS_PATH.test(sourceFile.fileName)
	);
}

function declarationName(node: ts.Node): string | undefined {
	if (
		ts.isInterfaceDeclaration(node) ||
		ts.isTypeAliasDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isEnumDeclaration(node)
	)
		return node.name?.text;
	if (
		ts.isVariableDeclaration(node) &&
		ts.isVariableStatement(node.parent.parent) &&
		ts.isSourceFile(node.parent.parent.parent)
	)
		return ts.isIdentifier(node.name) ? node.name.text : undefined;
	return undefined;
}

function isInvalidName(name: string | undefined): boolean {
	return name !== undefined && !name.endsWith("Event");
}

export const eventTypesSuffix: LintRule = ({ sourceFile, diagnostics }) => {
	if (!isEventsFile(sourceFile)) return;
	function visit(node: ts.Node): void {
		const name = declarationName(node);
		if (isInvalidName(name))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
