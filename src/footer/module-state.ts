import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";
import {
	requireNonEmptyString,
	requireRecord,
	requireString,
} from "../shared/validation.ts";
import {
	FOOTER_CURRENT_VALUE_FIELD,
	FOOTER_FOOTERS_LABEL,
	FOOTER_HERDR_TYPE,
	FOOTER_PERSISTED_LABEL,
	FOOTER_PR_TYPE,
	FOOTER_STATE_LABEL,
	FOOTER_TASK_TYPE,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
} from "./constants.ts";
import type { FooterType } from "./events.ts";

export interface FooterEntryState {
	footerType: FooterType;
	currentValue: string;
	isVisible: boolean;
	isLoading: boolean;
}

export interface FooterModuleState {
	footers: Record<string, FooterEntryState>;
}

export interface PersistedFooterEntry {
	footerType: FooterType;
	currentValue: string | null;
}

export interface PersistedFooterState {
	footers: Record<string, PersistedFooterEntry>;
}

const KNOWN_FOOTER_TYPES = [
	FOOTER_HERDR_TYPE,
	FOOTER_PR_TYPE,
	FOOTER_TASK_TYPE,
];

function knownFooterType(id: string): FooterType {
	for (const footerType of KNOWN_FOOTER_TYPES) {
		const isMatchingType = footerType.id === id;
		if (isMatchingType) return footerType;
	}
	return { id, name: id };
}

function parseFooterType(value: unknown): FooterType {
	if (typeof value === "string") return knownFooterType(value);
	const footerType = requireRecord(value, FOOTER_TYPE_FIELD);
	return {
		id: requireNonEmptyString(footerType.id, FOOTER_TYPE_FIELD),
		name: requireNonEmptyString(footerType.name, FOOTER_TYPE_FIELD),
	};
}

function legacyCurrentValue(footerType: FooterType, text: string): string {
	switch (footerType.id) {
		case FOOTER_PR_TYPE.id:
			return text.replace(/^\| PR Link: /, "").replace(/ \|$/, "");
		case FOOTER_TASK_TYPE.id:
			return text.replace(/^Todoist Task: /, "").replace(/ \|$/, "");
		default:
			return text;
	}
}

export function emptyFooterState(): FooterModuleState {
	return { footers: {} };
}

function persistedCurrentValue(
	footer: Record<string, unknown>,
	footerType: FooterType,
): string | null | undefined {
	const hasCurrentValue = Object.hasOwn(footer, FOOTER_CURRENT_VALUE_FIELD);
	if (hasCurrentValue) {
		const value = footer[FOOTER_CURRENT_VALUE_FIELD];
		const isNull = value === null;
		if (isNull) return null;
		try {
			return requireString(value, FOOTER_CURRENT_VALUE_FIELD);
		} catch {
			return undefined;
		}
	}
	const hasText = Object.hasOwn(footer, FOOTER_TEXT_FIELD);
	if (!hasText) return undefined;
	const value = footer[FOOTER_TEXT_FIELD];
	if (value === null) return null;
	try {
		return legacyCurrentValue(
			footerType,
			requireString(value, FOOTER_TEXT_FIELD),
		);
	} catch {
		return undefined;
	}
}

function parsePersistedFooter(value: unknown): FooterEntryState | undefined {
	try {
		const footer = requireRecord(value, FOOTER_PERSISTED_LABEL);
		const footerType = parseFooterType(footer[FOOTER_TYPE_FIELD]);
		const currentValue = persistedCurrentValue(footer, footerType);
		const hasCurrentValue = currentValue !== undefined;
		if (!hasCurrentValue) return undefined;
		return {
			footerType,
			currentValue: currentValue ?? "",
			isVisible: currentValue !== null,
			isLoading: false,
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
	const restored: Record<string, FooterEntryState> = {};
	for (const footer of Object.values(footers)) {
		const parsed = parsePersistedFooter(footer);
		const isTransientHerdr = parsed?.footerType.id === FOOTER_HERDR_TYPE.id;
		const hasPersistedFooter = parsed !== undefined && !isTransientHerdr;
		if (!hasPersistedFooter) continue;
		restored[parsed.footerType.id] = parsed;
	}
	return { footers: restored };
}

export function serializeFooterState(
	state: FooterModuleState,
): PersistedFooterState {
	const footers: Record<string, PersistedFooterEntry> = {};
	for (const event of Object.values(state.footers)) {
		const isTransientHerdr = event.footerType.id === FOOTER_HERDR_TYPE.id;
		if (isTransientHerdr) continue;
		const isVisible = event.isVisible;
		const persistedValue = isVisible ? event.currentValue : null;
		footers[event.footerType.id] = {
			footerType: event.footerType,
			currentValue: persistedValue,
		};
	}
	return { footers };
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
