import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

export const noDefaultParameters: LintRule = ({ sourceFile, diagnostics }) => {
	function visit(node: ts.Node): void {
		if (ts.isParameter(node) && node.initializer !== undefined)
			diagnostics.push(
				diagnostic(
					sourceFile,
					node,
					"no-default-parameters",
					"Default parameters are not allowed; resolve defaults inside the function body",
					1,
					0,
				),
			);
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
