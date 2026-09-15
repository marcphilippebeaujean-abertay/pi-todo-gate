import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";
import {
	requireBoolean,
	requireNonEmptyString,
	requireRecord,
	requireString,
} from "../shared/validation.ts";
import {
	FOOTER_EVENT_LABEL,
	FOOTER_FOOTERS_LABEL,
	FOOTER_HERDR_TYPE,
	FOOTER_LOADING_FIELD,
	FOOTER_PERSISTED_LABEL,
	FOOTER_STATE_LABEL,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
	FOOTER_VISIBLE_FIELD,
} from "./constants.ts";
import type { FooterUpdateEvent } from "./events.ts";

export type FooterUpdate = FooterUpdateEvent;

export interface FooterStatusState {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterModuleState {
	footers: Record<string, FooterStatusState>;
}

export interface PersistedFooterUpdate {
	footerType: string;
	isLoading?: boolean;
	text: string | null;
}

export interface PersistedFooterState {
	footers: Record<string, PersistedFooterUpdate>;
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

export function emptyFooterState(): FooterModuleState {
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

export function restoreFooterState(value: unknown): FooterModuleState | null {
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
		const isTransientHerdrFooter = parsed?.footerType === FOOTER_HERDR_TYPE;
		const hasPersistedFooter = parsed !== undefined && !isTransientHerdrFooter;
		if (hasPersistedFooter) restored[parsed.footerType] = parsed;
	}
	return { footers: restored };
}

function serializedText(event: FooterUpdate): string | null {
	const isVisible = event.isVisible;
	if (!isVisible) return null;
	return event.text;
}

export function serializeFooterState(
	state: FooterModuleState,
): PersistedFooterState {
	const footers: Record<string, PersistedFooterUpdate> = {};
	const persistedFooters = Object.values(state.footers).filter(
		(event) => event.footerType !== FOOTER_HERDR_TYPE,
	);
	for (const event of persistedFooters) {
		footers[event.footerType] = {
			footerType: event.footerType,
			isLoading: event.isLoading,
			text: serializedText(event),
		};
	}
	return { footers };
}

export function applyFooterUpdate(
	state: FooterModuleState,
	event: FooterUpdate,
): FooterModuleState {
	return {
		footers: {
			...state.footers,
			[event.footerType]: event,
		},
	};
}

export const footerStateDescriptor: ModuleStateDescriptor<
	"footer",
	FooterModuleState
> = {
	id: "footer",
	createInitialState: emptyFooterState,
	restore: (value) => restoreFooterState(value) ?? emptyFooterState(),
	serialize: (state): JsonValue =>
		structuredClone(serializeFooterState(state)) as unknown as JsonValue,
};
