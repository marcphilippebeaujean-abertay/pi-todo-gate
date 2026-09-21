import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_PATH = /[\\/]src[\\/]([^\\/]+)[\\/]module\.ts$/;
const RULE_ID = "module-class-export" as const;
const CONSUMER_MODULE = "./event-consumers.ts";
const EXPORT_MESSAGE = "module.ts must export only MODULE class";
const IMPORT_MESSAGE =
	"MODULE must import consumer class from event-consumers.ts";
const CONSTRUCTION_MESSAGE = "MODULE must construct imported consumer class";

function moduleName(sourceFile: ts.SourceFile): string | undefined {
	const match = sourceFile.fileName.replaceAll("\\", "/").match(MODULE_PATH);
	const directory = match?.[1];
	if (directory === undefined) return undefined;
	return directory
		.split(/[^A-Za-z0-9]+/)
		.filter((part) => part.length > 0)
		.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join("");
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	if (!ts.canHaveModifiers(node)) return false;
	return (
		ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false
	);
}

function exportedDeclarations(sourceFile: ts.SourceFile): ts.Node[] {
	const declarations = sourceFile.statements.filter((statement) =>
		hasModifier(statement, ts.SyntaxKind.ExportKeyword),
	);
	const exportStatements = sourceFile.statements.filter(
		(statement) =>
			ts.isExportDeclaration(statement) || ts.isExportAssignment(statement),
	);
	return [...declarations, ...exportStatements];
}

function isExpectedModuleClass(
	node: ts.Node,
	expectedName: string,
): node is ts.ClassDeclaration {
	return (
		ts.isClassDeclaration(node) &&
		node.name?.text === expectedName &&
		hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
		!hasModifier(node, ts.SyntaxKind.DefaultKeyword)
	);
}

function importedConsumerNames(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): Set<string> {
	const names = new Set<string>();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			statement.moduleSpecifier.text !== CONSUMER_MODULE
		)
			continue;
		const importClause = statement.importClause;
		if (importClause?.isTypeOnly) continue;
		const bindings = importClause?.namedBindings;
		if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			if (element.isTypeOnly || !ts.isIdentifier(element.name)) continue;
			const symbol = checker.getSymbolAtLocation(element.name);
			if (symbol === undefined) continue;
			const resolved =
				(symbol.flags & ts.SymbolFlags.Alias) !== 0
					? checker.getAliasedSymbol(symbol)
					: symbol;
			const isClass = resolved.declarations?.some((declaration) =>
				ts.isClassDeclaration(declaration),
			);
			if (isClass) names.add(element.name.text);
		}
	}
	return names;
}

function constructsConsumer(
	moduleClass: ts.ClassDeclaration,
	consumerNames: ReadonlySet<string>,
): boolean {
	let found = false;
	function visit(node: ts.Node): void {
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			consumerNames.has(node.expression.text)
		)
			found = true;
		if (!found) ts.forEachChild(node, visit);
	}
	visit(moduleClass);
	return found;
}

export const moduleClassExport: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	const name = moduleName(sourceFile);
	if (name === undefined) return;
	const expectedName = `${name}Module`;
	const exports = exportedDeclarations(sourceFile);
	const mainClass = exports.find((node) =>
		isExpectedModuleClass(node, expectedName),
	);
	for (const exported of exports) {
		if (exported === mainClass && exports.length === 1) continue;
		diagnostics.push(
			diagnostic(
				sourceFile,
				exported,
				RULE_ID,
				EXPORT_MESSAGE.replace("MODULE", expectedName),
				1,
				0,
			),
		);
	}
	if (mainClass === undefined) return;
	const consumerNames = importedConsumerNames(sourceFile, checker);
	if (consumerNames.size === 0) {
		diagnostics.push(
			diagnostic(
				sourceFile,
				mainClass,
				RULE_ID,
				IMPORT_MESSAGE.replace("MODULE", expectedName),
				1,
				0,
			),
		);
		return;
	}
	if (!constructsConsumer(mainClass, consumerNames))
		diagnostics.push(
			diagnostic(
				sourceFile,
				mainClass,
				RULE_ID,
				CONSTRUCTION_MESSAGE.replace("MODULE", expectedName),
				1,
				0,
			),
		);
};
