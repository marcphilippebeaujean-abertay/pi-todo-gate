import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const MODULE_STATE_PATH = /[\\/]src[\\/][^\\/]+[\\/]module-state\.ts$/;
const RULE_ID = "module-state-contract" as const;
const MESSAGE =
	"Module state must contain only JSON-compatible declarative values";
const SERIALIZABLE_CONTAINER_NAMES = new Set([
	"Array",
	"ReadonlyArray",
	"Record",
	"Readonly",
	"Partial",
	"Pick",
	"Omit",
]);
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

function isStateDeclaration(
	node: ts.Statement,
): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
	return (
		(ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
		node.name.text.endsWith("State")
	);
}

function isForbiddenTypeName(name: string): boolean {
	const finalName = name.split(".").at(-1) ?? name;
	return FORBIDDEN_NAMES.has(finalName);
}

function localTypeDeclaration(
	node: ts.TypeReferenceNode,
	checker: ts.TypeChecker,
):
	| ts.InterfaceDeclaration
	| ts.TypeAliasDeclaration
	| ts.ClassDeclaration
	| null {
	const symbol = checker.getSymbolAtLocation(node.typeName);
	const declaration = symbol?.declarations?.find(
		(candidate) =>
			ts.isInterfaceDeclaration(candidate) ||
			ts.isTypeAliasDeclaration(candidate) ||
			ts.isClassDeclaration(candidate),
	);
	return declaration ?? null;
}

function collectType(
	node: ts.TypeNode,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	if (ts.isTypeReferenceNode(node)) {
		const typeName = node.typeName.getText();
		if (isForbiddenTypeName(typeName)) return [node];
		const argumentOffenses = (node.typeArguments ?? []).flatMap((argument) =>
			collectType(argument, checker, seen),
		);
		if (SERIALIZABLE_CONTAINER_NAMES.has(typeName)) return argumentOffenses;
		const declaration = localTypeDeclaration(node, checker);
		if (declaration === null) return argumentOffenses;
		if (ts.isClassDeclaration(declaration)) return [node];
		return [
			...argumentOffenses,
			...collectDeclaration(declaration, checker, seen),
		];
	}
	if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node))
		return [node];
	if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node))
		return node.types.flatMap((type) => collectType(type, checker, seen));
	if (ts.isArrayTypeNode(node))
		return collectType(node.elementType, checker, seen);
	if (ts.isTupleTypeNode(node))
		return node.elements.flatMap((element) =>
			ts.isNamedTupleMember(element)
				? collectType(element.type, checker, seen)
				: collectType(element, checker, seen),
		);
	if (ts.isTypeLiteralNode(node))
		return node.members.flatMap((member) =>
			collectMember(member, checker, seen),
		);
	if (ts.isParenthesizedTypeNode(node))
		return collectType(node.type, checker, seen);
	if (
		ts.isLiteralTypeNode(node) &&
		node.literal.kind === ts.SyntaxKind.NullKeyword
	)
		return [];
	switch (node.kind) {
		case ts.SyntaxKind.StringKeyword:
		case ts.SyntaxKind.NumberKeyword:
		case ts.SyntaxKind.BooleanKeyword:
		case ts.SyntaxKind.NullKeyword:
			return [];
		default:
			return [node];
	}
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
		return member.type === undefined
			? [member]
			: collectType(member.type, checker, seen).slice(0, 1);
	if (!ts.isPropertySignature(member) || member.type === undefined)
		return [member];
	const offenses = collectType(member.type, checker, seen);
	return ts.isTypeLiteralNode(member.type) ? offenses : offenses.slice(0, 1);
}

function collectHeritageType(
	type: ts.ExpressionWithTypeArguments,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	const symbol = checker.getSymbolAtLocation(type.expression);
	const declaration = symbol?.declarations?.find(
		(candidate) =>
			ts.isInterfaceDeclaration(candidate) ||
			ts.isTypeAliasDeclaration(candidate) ||
			ts.isClassDeclaration(candidate),
	);
	const argumentOffenses = (type.typeArguments ?? []).flatMap((argument) =>
		collectType(argument, checker, seen),
	);
	if (declaration === undefined) return argumentOffenses;
	if (ts.isClassDeclaration(declaration)) return [type.expression];
	return [
		...argumentOffenses,
		...collectDeclaration(declaration, checker, seen),
	];
}

function collectDeclaration(
	declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
	checker: ts.TypeChecker,
	seen: Set<ts.Declaration>,
): ts.Node[] {
	if (seen.has(declaration)) return [];
	seen.add(declaration);
	const offenses = ts.isInterfaceDeclaration(declaration)
		? [
				...(declaration.heritageClauses?.flatMap((clause) =>
					clause.types.flatMap((type) =>
						collectHeritageType(type, checker, seen),
					),
				) ?? []),
				...declaration.members.flatMap((member) =>
					collectMember(member, checker, seen),
				),
			]
		: collectType(declaration.type, checker, seen);
	seen.delete(declaration);
	return offenses;
}

function collectStateDeclarations(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): Array<ts.InterfaceDeclaration | ts.TypeAliasDeclaration> {
	const declarations = new Set<
		ts.InterfaceDeclaration | ts.TypeAliasDeclaration
	>(sourceFile.statements.filter(isStateDeclaration));
	function visit(node: ts.Node): void {
		if (
			ts.isTypeReferenceNode(node) &&
			node.typeName.getText().split(".").at(-1) === "ModuleStateDescriptor"
		) {
			const stateType = node.typeArguments?.[1];
			if (stateType !== undefined && ts.isTypeReferenceNode(stateType)) {
				const declaration = localTypeDeclaration(stateType, checker);
				if (declaration !== null && !ts.isClassDeclaration(declaration))
					declarations.add(declaration);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return [...declarations];
}

export const moduleStateContract: LintRule = ({
	sourceFile,
	diagnostics,
	checker,
}) => {
	if (!MODULE_STATE_PATH.test(sourceFile.fileName)) return;
	const reported = new Set<ts.Node>();
	for (const statement of sourceFile.statements) {
		if (ts.isClassDeclaration(statement)) {
			if (!reported.has(statement)) {
				reported.add(statement);
				diagnostics.push(
					diagnostic(sourceFile, statement, RULE_ID, MESSAGE, 1, 0),
				);
			}
		}
	}
	for (const declaration of collectStateDeclarations(sourceFile, checker)) {
		for (const offense of collectDeclaration(
			declaration,
			checker,
			new Set<ts.Declaration>(),
		)) {
			if (reported.has(offense)) continue;
			reported.add(offense);
			diagnostics.push(diagnostic(sourceFile, offense, RULE_ID, MESSAGE, 1, 0));
		}
	}
};
