import ts from "typescript";
import { diagnostic } from "../diagnostic.ts";
import type { LintRule } from "../types.ts";

const RULE_ID = "no-worker-consumer-callbacks" as const;
const REQUEST_NAME = "ClaimWorkerRequest";
const CALLBACK_NAMES = new Set(["onClaimComplete", "onFailure"]);
const MESSAGE =
	"Worker requests must publish typed result events instead of calling consumers";

function propertyName(member: ts.PropertySignature): string | undefined {
	const name = member.name;
	return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

function isCallbackField(
	member: ts.TypeElement,
): member is ts.PropertySignature {
	if (!ts.isPropertySignature(member)) return false;
	const name = propertyName(member);
	const isCallbackName = name !== undefined && CALLBACK_NAMES.has(name);
	return (
		isCallbackName &&
		member.type !== undefined &&
		ts.isFunctionTypeNode(member.type)
	);
}

export const noWorkerConsumerCallbacks: LintRule = ({
	sourceFile,
	diagnostics,
}) => {
	function visit(node: ts.Node): void {
		if (ts.isInterfaceDeclaration(node) && node.name.text === REQUEST_NAME)
			for (const member of node.members)
				if (isCallbackField(member))
					diagnostics.push(
						diagnostic(sourceFile, member, RULE_ID, MESSAGE, 1, 0),
					);
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
};
