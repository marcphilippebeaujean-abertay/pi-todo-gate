import { EXTENSION_CONSTANTS as C } from "./constants.ts";

const STRING_TYPE = "string";
const OBJECT_TYPE = "object";

export function textOf(value: unknown): string {
	const isStringValue = typeof value === STRING_TYPE;
	if (isStringValue) return value as string;
	const isArrayValue = Array.isArray(value);
	if (isArrayValue)
		return value
			.map((part: unknown) => {
				const isObjectPart = typeof part === OBJECT_TYPE && part !== null;
				if (!isObjectPart) return "";
				const record = part as Record<string, unknown>;
				const hasText = C.content.text in record;
				if (!hasText) return "";
				return String(record.text);
			})
			.join(" ");
	const isObjectValue = typeof value === OBJECT_TYPE;
	const isNullValue = value === null;
	const isNotObject = !isObjectValue || isNullValue;
	if (isNotObject) return "";
	const record = value as Record<string, unknown>;
	const hasContent = C.content.content in record;
	if (!hasContent) return "";
	return textOf(record.content);
}

export function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return {
		content: [{ type: C.content.text, text }],
		details: undefined,
	};
}

export function branchTexts(entries: readonly unknown[]): string[] {
	return entries
		.filter((entry) => {
			const isObjectEntry = typeof entry === OBJECT_TYPE && entry !== null;
			if (!isObjectEntry) return false;
			return (entry as { type?: unknown }).type !== C.entry.custom;
		})
		.map((entry) => JSON.stringify(entry));
}
