import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_CONTRACT_PATH = /[\\/]src[\\/]shared[\\/]session-state\.ts$/;
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
	return declarationName(node) === "ModuleState";
}

function isForbiddenTypeName(name: string): boolean {
	const finalName = name.split(".").at(-1) ?? name;
	return FORBIDDEN_NAMES.has(finalName);
}

function collectMember(
	member: ts.TypeElement,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	if (
		ts.isMethodSignature(member) ||
		ts.isCallSignatureDeclaration(member) ||
		ts.isConstructSignatureDeclaration(member)
	)
		return [member];
	if (ts.isIndexSignatureDeclaration(member))
		return collectType(member.type, checker, seen);
	if (!ts.isPropertySignature(member) || member.type === undefined) return [];
	return collectType(member.type, checker, seen);
}

function collectDeclaration(
	declaration: ts.Declaration,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	if (seen.has(declaration)) return [];
	seen.add(declaration);
	let result: ts.Node[] = [];
	if (ts.isInterfaceDeclaration(declaration)) {
		for (const member of declaration.members)
			result = [...result, ...collectMember(member, checker, seen)];
	} else if (ts.isTypeAliasDeclaration(declaration)) {
		result = collectType(declaration.type, checker, seen);
	}
	seen.delete(declaration);
	return result;
}

function collectTypeReference(
	node: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	const name = node.typeName.getText();
	if (isForbiddenTypeName(name)) return [node];
	const argumentResults = (node.typeArguments ?? []).flatMap((argument) =>
		collectType(argument, checker, seen),
	);
	const symbol = checker.getSymbolAtLocation(node.typeName);
	const declaration = symbol?.declarations?.find((candidate) => {
		return (
			ts.isInterfaceDeclaration(candidate) ||
			ts.isTypeAliasDeclaration(candidate) ||
			ts.isClassDeclaration(candidate)
		);
	});
	if (declaration === undefined) return argumentResults;
	if (ts.isClassDeclaration(declaration)) return [node];
	return [
		...argumentResults,
		...collectDeclaration(declaration, checker, seen),
	];
}

function collectType(
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	if (ts.isTypeReferenceNode(node))
		return collectTypeReference(node, checker, seen);
	if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node))
		return [node];
	if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
		for (const type of node.types) {
			const result = collectType(type, checker, seen);
			if (result.length > 0) return result.slice(0, 1);
		}
		return [];
	}
	if (ts.isTypeLiteralNode(node))
		return node.members.flatMap((member) =>
			collectMember(member, checker, seen),
		);
	let result: ts.Node[] = [];
	ts.forEachChild(node, (child) => {
		if (result.length > 0 || !ts.isTypeNode(child)) return;
		result = collectType(child, checker, seen);
	});
	return result;
}

function report(
	sourceFile: ts.SourceFile,
	node: ts.Node,
	diagnostics: Parameters<LintRule>[0]["diagnostics"],
): void {
	diagnostics.push(diagnostic(sourceFile, node, RULE_ID, MESSAGE, 1, 0));
}

export const noNonserializableModuleState: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	if (!MODULE_CONTRACT_PATH.test(sourceFile.fileName)) return;
	for (const statement of sourceFile.statements) {
		if (
			!ts.isInterfaceDeclaration(statement) &&
			!ts.isTypeAliasDeclaration(statement)
		)
			continue;
		if (!isModuleStateDeclaration(statement)) continue;
		for (const offendingNode of collectDeclaration(
			statement,
			checker,
			new Set<ts.Declaration>(),
		))
			report(sourceFile, offendingNode, diagnostics);
	}
};
