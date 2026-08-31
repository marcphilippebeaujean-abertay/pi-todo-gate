import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const CLAIM_CUSTOM_TYPE = "herdr-claim-gate";
const CUSTOM_ENTRY_TYPE = "custom";
const EMPTY_TEXT = "";
const NEWLINE = "\n";
const INFO_LEVEL = "info";

export function labelIsDescriptive(label: string | undefined | null): boolean {
	if (!label) return false;
	const value = label.trim();
	return Boolean(value) && !/^\d+$/.test(value);
}

export function extractLabel(text: string): string | undefined {
	return text.match(/"label"\s*:\s*"([^"]*)"/)?.[1];
}

export function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return EMPTY_TEXT;
	return value
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part
				? String(part.text)
				: EMPTY_TEXT,
		)
		.join(NEWLINE);
}

export function notify(
	ctx: Pick<ExtensionContext, "ui">,
	message: string,
	level: "info" | "warning" | "error" = INFO_LEVEL,
): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}

export function alreadyClaimed(ctx: {
	sessionManager: {
		getEntries: () => Array<{ type?: string; customType?: string }>;
	};
}): boolean {
	try {
		return ctx.sessionManager
			.getEntries()
			.some(
				(entry) =>
					entry?.type === CUSTOM_ENTRY_TYPE &&
					entry?.customType === CLAIM_CUSTOM_TYPE,
			);
	} catch {
		return false;
	}
}
