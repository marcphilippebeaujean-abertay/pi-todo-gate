import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const CLAIM_CUSTOM_TYPE = "herdr-claim-gate";
const CUSTOM_ENTRY_TYPE = "custom";
const INFO_LEVEL = "info";
const LABEL_PATTERN = /"label"\s*:\s*"([^"]*)"/;
const TEXT_PROPERTY = "text";
const STRING_TYPE = "string";
const OBJECT_TYPE = "object";
const CLAIM_COMPLETE_MESSAGE = "Herdr claim complete";

export function labelIsDescriptive(label: string | undefined | null): boolean {
	const hasNoLabel = !label;
	if (hasNoLabel) return false;
	const value = label.trim();
	const hasValue = Boolean(value);
	const isNotNumeric = !/^\d+$/.test(value);
	return hasValue && isNotNumeric;
}

export function extractLabel(text: string): string | undefined {
	return text.match(LABEL_PATTERN)?.[1];
}

export function textOf(value: unknown): string {
	const isText = typeof value === STRING_TYPE;
	if (isText) return value as string;
	const isNotArray = !Array.isArray(value);
	if (isNotArray) return "";
	return value
		.map((part) => {
			const isNotObject = typeof part !== OBJECT_TYPE || part === null;
			if (isNotObject) return "";
			const hasText = TEXT_PROPERTY in part;
			if (!hasText) return "";
			return String(part.text);
		})
		.join("\n");
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

export function liftGate(
	state: { gateActive: boolean },
	ctx?: Pick<ExtensionContext, "ui">,
): void {
	state.gateActive = false;
	if (ctx === undefined) return;
	notify(ctx, CLAIM_COMPLETE_MESSAGE, INFO_LEVEL);
}

export function persistClaimed(
	pi: Pick<ExtensionAPI, "appendEntry">,
	state: { gateActive: boolean },
	ctx?: Pick<ExtensionContext, "ui">,
): void {
	try {
		pi.appendEntry(CLAIM_CUSTOM_TYPE, { at: Date.now() });
	} catch {
		// Gate state still lifts in memory when persistence is unavailable.
	}
	liftGate(state, ctx);
}

export function alreadyClaimed(ctx: {
	sessionManager: {
		getEntries: () => Array<{ type?: string; customType?: string }>;
	};
}): boolean {
	try {
		return ctx.sessionManager.getEntries().some((entry) => {
			const isCustomEntry = entry?.type === CUSTOM_ENTRY_TYPE;
			const isClaimEntry = entry?.customType === CLAIM_CUSTOM_TYPE;
			return isCustomEntry && isClaimEntry;
		});
	} catch {
		return false;
	}
}
