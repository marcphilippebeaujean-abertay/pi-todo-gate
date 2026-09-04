import type { FooterUpdate } from "./types.ts";

export function isFooterUpdate(value: unknown): value is FooterUpdate {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const event = value as Partial<FooterUpdate>;
	return (
		typeof event.footerType === "string" &&
		event.footerType.length > 0 &&
		typeof event.isLoading === "boolean" &&
		typeof event.text === "string" &&
		typeof event.isVisible === "boolean"
	);
}
