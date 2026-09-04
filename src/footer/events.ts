import {
	FOOTER_EVENT_LABEL,
	FOOTER_LOADING_FIELD,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
	FOOTER_VISIBLE_FIELD,
} from "./constants.ts";
import type { FooterUpdate } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

export function requireRecord(value: unknown, field: string): UnknownRecord {
	if (typeof value !== "object")
		throw new TypeError(`${field} must be an object`);
	if (value === null) throw new TypeError(`${field} must not be null`);
	const isArray = Array.isArray(value);
	if (isArray) throw new TypeError(`${field} must not be an array`);
	return value as UnknownRecord;
}

export function requireString(value: unknown, field: string): string {
	if (typeof value !== "string")
		throw new TypeError(`${field} must be a string`);
	return value;
}

export function requireNonEmptyString(value: unknown, field: string): string {
	const text = requireString(value, field);
	const isEmpty = text.length === 0;
	if (isEmpty) throw new TypeError(`${field} must not be empty`);
	return text;
}

export function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean")
		throw new TypeError(`${field} must be a boolean`);
	return value;
}

export function parseFooterEvent(value: unknown): FooterUpdate {
	const event = requireRecord(value, FOOTER_EVENT_LABEL);
	return {
		footerType: requireNonEmptyString(event.footerType, FOOTER_TYPE_FIELD),
		isLoading: requireBoolean(event.isLoading, FOOTER_LOADING_FIELD),
		text: requireString(event.text, FOOTER_TEXT_FIELD),
		isVisible: requireBoolean(event.isVisible, FOOTER_VISIBLE_FIELD),
	};
}
