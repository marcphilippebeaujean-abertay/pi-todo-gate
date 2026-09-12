import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const EVENTS_FILE_NAME = "events.ts";
const SOURCE_PATH = /[\\/]src[\\/].+\.ts$/;
const RULE_ID = "event-types-location" as const;
const MESSAGE = "Event-related types must live in events.ts";

function isEventsFile(sourceFile: ts.SourceFile): boolean {
	return (
		basename(sourceFile.fileName) === EVENTS_FILE_NAME &&
		SOURCE_PATH.test(sourceFile.fileName)
	);
}

function declarationName(node: ts.Node): string | undefined {
	if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
		return node.name.text;
	return undefined;
}

function isEventRelated(name: string | undefined): boolean {
	return name?.toLowerCase().includes("event") === true;
}

export const eventTypesLocation: LintRule = ({ sourceFile, diagnostics }) => {
	if (!SOURCE_PATH.test(sourceFile.fileName) || isEventsFile(sourceFile))
		return;
	function visit(node: ts.Node): void {
		const name = declarationName(node);
		if (isEventRelated(name))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
