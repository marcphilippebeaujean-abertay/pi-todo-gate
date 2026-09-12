import { basename } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const DATA_FILE_NAME = "data.ts";
const RULE_ID = "no-functions-in-data" as const;
const MESSAGE = "Data files must not contain business functions";

function isFunctionLike(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node) ||
		ts.isConstructorDeclaration(node)
	);
}

export const noFunctionsInData: LintRule = ({ sourceFile, diagnostics }) => {
	const isDataFile = basename(sourceFile.fileName) === DATA_FILE_NAME;
	if (!isDataFile) return;
	function visit(node: ts.Node): void {
		if (isFunctionLike(node))
			diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
