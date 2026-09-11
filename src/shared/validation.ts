export type UnknownRecord = Record<string, unknown>;

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
