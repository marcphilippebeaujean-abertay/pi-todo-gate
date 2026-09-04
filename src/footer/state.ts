import {
	FOOTER_FOOTERS_LABEL,
	FOOTER_LOADING_FIELD,
	FOOTER_PERSISTED_LABEL,
	FOOTER_STATE_LABEL,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
} from "./constants.ts";
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
	const hasText = Object.hasOwn(footer, FOOTER_TEXT_FIELD);
	if (!hasText) return undefined;
	const textValue = footer[FOOTER_TEXT_FIELD];
	const isHidden = textValue === null;
	if (isHidden) return null;
	try {
		return requireString(textValue, FOOTER_TEXT_FIELD);
	} catch {
		return undefined;
	}
}

function persistedLoading(value: unknown): boolean {
	const isBoolean = typeof value === "boolean";
	if (!isBoolean) return false;
	return value;
}

function parsePersistedFooter(value: unknown): FooterUpdate | undefined {
	try {
		const footer = requireRecord(value, FOOTER_PERSISTED_LABEL);
		const footerType = requireNonEmptyString(
			footer[FOOTER_TYPE_FIELD],
			FOOTER_TYPE_FIELD,
		);
		const textValue = persistedText(footer);
		const hasTextValue = textValue !== undefined;
		if (!hasTextValue) return undefined;
		return {
			footerType,
			isLoading: persistedLoading(footer[FOOTER_LOADING_FIELD]),
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
		persisted = requireRecord(value, FOOTER_STATE_LABEL);
	} catch {
		return null;
	}

	let footers: Record<string, unknown>;
	try {
		footers = requireRecord(persisted.footers, FOOTER_FOOTERS_LABEL);
	} catch {
		return null;
	}

	const restored: Record<string, FooterUpdate> = {};
	for (const footer of Object.values(footers)) {
		const parsed = parsePersistedFooter(footer);
		const hasParsedFooter = parsed !== undefined;
		if (hasParsedFooter) restored[parsed.footerType] = parsed;
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
