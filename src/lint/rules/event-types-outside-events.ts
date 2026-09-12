import { basename, dirname, join, relative } from "node:path";
import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintDiagnostic, LintRule } from "../types.ts";

const EVENTS_FILE_NAME = "events.ts";
const EVENT_FILE_PATH =
	/[\\/]src[\\/](pr|todoist|herdr|worktree|exit-protocol|footer)[\\/](event-consumers|event-publishers)\.ts$/;
const RULE_ID = "event-types-outside-events" as const;
const MESSAGE =
	"Event payload types must live in events.ts; request and options contracts may live in state.ts";

function isEventFile(sourceFile: ts.SourceFile): boolean {
	return EVENT_FILE_PATH.test(sourceFile.fileName);
}

function isFunctionLikeDeclaration(
	node: ts.Node,
): node is ts.FunctionLikeDeclaration {
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

function isExported(node: ts.Node): boolean {
	return (
		(ts.getCombinedModifierFlags(node as ts.Declaration) &
			ts.ModifierFlags.Export) !==
		0
	);
}

function unparenthesized(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (ts.isParenthesizedExpression(current)) current = current.expression;
	return current;
}

interface CallbackTarget {
	declaration: ts.FunctionLikeDeclaration;
	boundParameterCount: number;
}

function callbackTargets(
	declarations: readonly ts.Declaration[],
	boundParameterCount: number,
): CallbackTarget[] {
	const targets: CallbackTarget[] = [];
	for (const declaration of declarations) {
		if (isFunctionLikeDeclaration(declaration)) {
			targets.push({ declaration, boundParameterCount });
			continue;
		}
		if (
			ts.isVariableDeclaration(declaration) &&
			declaration.initializer !== undefined &&
			isFunctionLikeDeclaration(declaration.initializer)
		)
			targets.push({
				declaration: declaration.initializer,
				boundParameterCount,
			});
		if (
			ts.isPropertyAssignment(declaration) &&
			isFunctionLikeDeclaration(declaration.initializer)
		)
			targets.push({
				declaration: declaration.initializer,
				boundParameterCount,
			});
	}
	return targets;
}

function callbackDeclarations(
	expression: ts.Expression,
	checker: ts.TypeChecker,
	boundParameterCount = 0,
): CallbackTarget[] {
	const callback = unparenthesized(expression);
	if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
		return [{ declaration: callback, boundParameterCount }];
	if (
		ts.isCallExpression(callback) &&
		ts.isPropertyAccessExpression(callback.expression) &&
		callback.expression.name.text === "bind"
	) {
		const additionalBoundParameters = Math.max(
			0,
			callback.arguments.length - 1,
		);
		return callbackDeclarations(
			callback.expression.expression,
			checker,
			boundParameterCount + additionalBoundParameters,
		);
	}
	if (ts.isIdentifier(callback)) {
		const symbol = checker.getSymbolAtLocation(callback);
		return callbackTargets(symbol?.declarations ?? [], boundParameterCount);
	}
	if (ts.isPropertyAccessExpression(callback)) {
		const symbol = checker.getSymbolAtLocation(callback.name);
		return callbackTargets(symbol?.declarations ?? [], boundParameterCount);
	}
	return [];
}

function isEventRegistration(node: ts.CallExpression): boolean {
	return (
		ts.isPropertyAccessExpression(node.expression) &&
		node.expression.name.text === "on" &&
		node.arguments.length > 0
	);
}

function eventListenerArgument(
	node: ts.CallExpression,
): ts.Expression | undefined {
	const listenerIndex = node.arguments.length > 1 ? 1 : 0;
	return node.arguments[listenerIndex];
}

function containsEventEmission(node: ts.Node): boolean {
	let found = false;
	function visit(candidate: ts.Node): void {
		if (found) return;
		if (
			ts.isCallExpression(candidate) &&
			ts.isPropertyAccessExpression(candidate.expression) &&
			candidate.expression.name.text === "emit"
		) {
			found = true;
			return;
		}
		ts.forEachChild(candidate, visit);
	}
	visit(node);
	return found;
}

function hasTypeOutsideEvents(
	typeNode: ts.TypeNode,
	moduleEventsPath: string,
	checker: ts.TypeChecker,
): boolean {
	const modulePath = dirname(moduleEventsPath);
	let found = false;
	function visit(node: ts.Node): void {
		if (found) return;
		if (ts.isTypeLiteralNode(node)) {
			found = true;
			return;
		}
		if (ts.isTypeReferenceNode(node)) {
			const symbol = checker.getSymbolAtLocation(node.typeName);
			const resolved =
				symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
					? checker.getAliasedSymbol(symbol)
					: symbol;
			const isOutsideEvents = resolved?.declarations?.some((candidate) => {
				const fileName = candidate.getSourceFile().fileName;
				const relativePath = relative(modulePath, fileName);
				const declarationName = (
					candidate as ts.Declaration & { name?: ts.Node }
				).name?.getText();
				const isStateSupportContract =
					basename(fileName) === "state.ts" &&
					(declarationName?.endsWith("Request") === true ||
						declarationName?.endsWith("Options") === true);
				return (
					relativePath !== "" &&
					!relativePath.startsWith("..") &&
					basename(fileName) !== EVENTS_FILE_NAME &&
					!isStateSupportContract
				);
			});
			if (isOutsideEvents) {
				found = true;
				return;
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(typeNode);
	return found;
}

function checkFunction(
	sourceFile: ts.SourceFile,
	functionNode: ts.FunctionLikeDeclaration,
	moduleEventsPath: string,
	checker: ts.TypeChecker,
	diagnostics: LintDiagnostic[],
	boundParameterCount = 0,
): void {
	for (const parameter of functionNode.parameters.slice(boundParameterCount)) {
		const type = parameter.type;
		if (type === undefined) continue;
		const hasInvalidType = hasTypeOutsideEvents(
			type,
			moduleEventsPath,
			checker,
		);
		if (hasInvalidType)
			diagnostics.push(diagnostic(sourceFile, type, RULE_ID, MESSAGE, 1, 0));
	}
}

export const eventTypesOutsideEvents: LintRule = ({
	sourceFile,
	checker,
	diagnostics,
}) => {
	if (!isEventFile(sourceFile)) return;
	const moduleEventsPath = join(dirname(sourceFile.fileName), EVENTS_FILE_NAME);
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && isEventRegistration(node)) {
			const callback = eventListenerArgument(node);
			if (callback !== undefined)
				for (const target of callbackDeclarations(callback, checker))
					checkFunction(
						sourceFile,
						target.declaration,
						moduleEventsPath,
						checker,
						diagnostics,
						target.boundParameterCount,
					);
		}
		if (
			ts.isFunctionDeclaration(node) &&
			isExported(node) &&
			containsEventEmission(node)
		)
			checkFunction(sourceFile, node, moduleEventsPath, checker, diagnostics);
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
