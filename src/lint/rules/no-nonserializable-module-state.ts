import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const ROOT_STATE_PATH = /[\\/]src[\\/]state\.ts$/;
const MODULE_STATE_SUFFIX = "ModuleState";
const RULE_ID = "no-nonserializable-module-state" as const;
const MESSAGE =
	"Module state must contain only JSON-compatible declarative values";
const FORBIDDEN_NAMES = new Set([
	"Promise",
	"Set",
	"ReadonlySet",
	"Map",
	"ReadonlyMap",
	"WeakMap",
	"WeakSet",
	"Function",
	"ExtensionContext",
	"Timeout",
	"Worker",
	"Date",
	"RegExp",
	"Error",
]);

function declarationName(node: ts.Declaration): string | null {
	if (!ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node))
		return null;
	return node.name.text;
}

function isModuleStateDeclaration(node: ts.Declaration): boolean {
	const name = declarationName(node);
	return name === "ModuleState" || name?.endsWith(MODULE_STATE_SUFFIX) === true;
}

function report(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
}

function typeName(node: ts.TypeReferenceNode): string {
	return node.typeName.getText();
}

function isForbiddenTypeName(name: string): boolean {
	const finalName = name.split(".").at(-1) ?? name;
	return FORBIDDEN_NAMES.has(finalName);
}

function inspectMember(
	member: ts.TypeElement,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
	sourceFile: ts.SourceFile,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	if (
		ts.isMethodSignature(member) ||
		ts.isConstructSignatureDeclaration(member)
	) {
		report(sourceFile, member, diagnostics);
		return;
	}
	if (!ts.isPropertySignature(member)) return;
	if (member.type === undefined) return;
	inspectTypeNode(member.type, checker, seen, sourceFile, diagnostics);
}

function inspectDeclaration(
	declaration: ts.Declaration,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
	sourceFile: ts.SourceFile,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	if (seen.has(declaration)) return;
	seen.add(declaration);
	if (ts.isInterfaceDeclaration(declaration)) {
		for (const member of declaration.members)
			inspectMember(member, checker, seen, sourceFile, diagnostics);
		return;
	}
	if (ts.isTypeAliasDeclaration(declaration))
		inspectTypeNode(declaration.type, checker, seen, sourceFile, diagnostics);
}

function inspectTypeReference(
	node: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
	sourceFile: ts.SourceFile,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	const name = typeName(node);
	if (isForbiddenTypeName(name)) {
		report(sourceFile, node, diagnostics);
		return;
	}
	for (const argument of node.typeArguments ?? [])
		inspectTypeNode(argument, checker, seen, sourceFile, diagnostics);
	const symbol = checker.getSymbolAtLocation(node.typeName);
	const declaration = symbol?.declarations?.find((candidate) => {
		return (
			ts.isInterfaceDeclaration(candidate) ||
			ts.isTypeAliasDeclaration(candidate) ||
			ts.isClassDeclaration(candidate)
		);
	});
	if (declaration === undefined) return;
	if (ts.isClassDeclaration(declaration)) {
		report(sourceFile, node, diagnostics);
		return;
	}
	inspectDeclaration(declaration, checker, seen, sourceFile, diagnostics);
}

function inspectTypeNode(
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
	sourceFile: ts.SourceFile,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	if (ts.isTypeReferenceNode(node)) {
		inspectTypeReference(node, checker, seen, sourceFile, diagnostics);
		return;
	}
	if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
		report(sourceFile, node, diagnostics);
		return;
	}
	if (ts.isTypeLiteralNode(node)) {
		for (const member of node.members)
			inspectMember(member, checker, seen, sourceFile, diagnostics);
		return;
	}
	ts.forEachChild(node, (child) => {
		if (ts.isTypeNode(child))
			inspectTypeNode(child, checker, seen, sourceFile, diagnostics);
	});
}

export const noNonserializableModuleState: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	if (!ROOT_STATE_PATH.test(sourceFile.fileName)) return;
	const seen = new Set<ts.Declaration>();
	for (const statement of sourceFile.statements) {
		if (
			!ts.isInterfaceDeclaration(statement) &&
			!ts.isTypeAliasDeclaration(statement)
		)
			continue;
		if (!isModuleStateDeclaration(statement)) continue;
		inspectDeclaration(statement, checker, seen, sourceFile, diagnostics);
	}
};
