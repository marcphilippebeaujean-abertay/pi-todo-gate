import {
	requireNonEmptyString,
	requireRecord,
	requireString,
} from "./events.ts";
import type {
	FooterState,
	FooterUpdate,
	PersistedFooterState,
	PersistedFooterUpdate,
} from "./types.ts";

export function emptyFooterState(): FooterState {
	return { footers: {} };
}

function persistedText(
	footer: Record<string, unknown>,
): string | null | undefined {
	if (!("text" in footer)) return undefined;
	if (footer.text === null) return null;
	try {
		return requireString(footer.text, "text");
	} catch {
		return undefined;
	}
}

function persistedLoading(value: unknown): boolean {
	if (typeof value !== "boolean") return false;
	return value;
}

function parsePersistedFooter(value: unknown): FooterUpdate | undefined {
	try {
		const footer = requireRecord(value, "persisted footer");
		const footerType = requireNonEmptyString(footer.footerType, "footerType");
		const textValue = persistedText(footer);
		if (textValue === undefined) return undefined;
		return {
			footerType,
			isLoading: persistedLoading(footer.isLoading),
			text: textValue ?? "",
			isVisible: textValue !== null,
		};
	} catch {
		return undefined;
	}
}

export function restoreFooterState(value: unknown): FooterState | null {
	let persisted: Record<string, unknown>;
	try {
		persisted = requireRecord(value, "footer state");
	} catch {
		return null;
	}

	let footers: Record<string, unknown>;
	try {
		footers = requireRecord(persisted.footers, "footer state footers");
	} catch {
		return null;
	}

	const restored: Record<string, FooterUpdate> = {};
	for (const footer of Object.values(footers)) {
		const parsed = parsePersistedFooter(footer);
		if (parsed) restored[parsed.footerType] = parsed;
	}
	return { footers: restored };
}

export function serializeFooterState(state: FooterState): PersistedFooterState {
	const footers: Record<string, PersistedFooterUpdate> = {};
	for (const event of Object.values(state.footers)) {
		footers[event.footerType] = {
			footerType: event.footerType,
			isLoading: event.isLoading,
			text: event.isVisible ? event.text : null,
		};
	}
	return { footers };
}

export function applyFooterUpdate(
	state: FooterState,
	event: FooterUpdate,
): FooterState {
	return {
		footers: {
			...state.footers,
			[event.footerType]: event,
		},
	};
}
