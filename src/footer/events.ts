import type { FooterUpdate } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

export function requireRecord(value: unknown, field: string): UnknownRecord {
	if (typeof value !== "object")
		throw new TypeError(`${field} must be an object`);
	if (value === null) throw new TypeError(`${field} must not be null`);
	if (Array.isArray(value))
		throw new TypeError(`${field} must not be an array`);
	return value as UnknownRecord;
}

export function requireString(value: unknown, field: string): string {
	if (typeof value !== "string")
		throw new TypeError(`${field} must be a string`);
	return value;
}

export function requireNonEmptyString(value: unknown, field: string): string {
	const text = requireString(value, field);
	if (text.length === 0) throw new TypeError(`${field} must not be empty`);
	return text;
}

export function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean")
		throw new TypeError(`${field} must be a boolean`);
	return value;
}

export function parseFooterEvent(value: unknown): FooterUpdate {
	const event = requireRecord(value, "footer event");
	return {
		footerType: requireNonEmptyString(event.footerType, "footerType"),
		isLoading: requireBoolean(event.isLoading, "isLoading"),
		text: requireString(event.text, "text"),
		isVisible: requireBoolean(event.isVisible, "isVisible"),
	};
}
