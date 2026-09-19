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
	FOOTER_CURRENT_VALUE_FIELD,
	FOOTER_EVENT_LABEL,
	FOOTER_FOOTERS_LABEL,
	FOOTER_HERDR_TYPE,
	FOOTER_LOADING_FIELD,
	FOOTER_PERSISTED_LABEL,
	FOOTER_PR_TYPE,
	FOOTER_STATE_LABEL,
	FOOTER_TASK_TYPE,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
	FOOTER_VISIBLE_FIELD,
} from "./constants.ts";
import type { FooterType, FooterUpdateEvent } from "./events.ts";

export type FooterUpdate = FooterUpdateEvent;

export interface FooterStatusState extends FooterUpdateEvent {}

export interface FooterModuleState {
	footers: Record<string, FooterStatusState>;
}

export interface PersistedFooterUpdate {
	footerType: FooterType;
	isLoading?: boolean;
	currentValue: string | null;
}

export interface PersistedFooterState {
	footers: Record<string, PersistedFooterUpdate>;
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

function eventCurrentValue(
	event: Record<string, unknown>,
	footerType: FooterType,
): string {
	const hasCurrentValue = Object.hasOwn(event, FOOTER_CURRENT_VALUE_FIELD);
	if (hasCurrentValue)
		return requireString(
			event[FOOTER_CURRENT_VALUE_FIELD],
			FOOTER_CURRENT_VALUE_FIELD,
		);
	return legacyCurrentValue(
		footerType,
		requireString(event[FOOTER_TEXT_FIELD], FOOTER_TEXT_FIELD),
	);
}

export function parseFooterEvent(value: unknown): FooterUpdate {
	const event = requireRecord(value, FOOTER_EVENT_LABEL);
	const footerType = parseFooterType(event.footerType);
	return {
		footerType,
		isLoading: requireBoolean(event.isLoading, FOOTER_LOADING_FIELD),
		currentValue: eventCurrentValue(event, footerType),
		isVisible: requireBoolean(event.isVisible, FOOTER_VISIBLE_FIELD),
	};
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
		if (value === null) return null;
		try {
			return requireString(value, FOOTER_CURRENT_VALUE_FIELD);
		} catch {
			return undefined;
		}
	}
	const hasText = Object.hasOwn(footer, FOOTER_TEXT_FIELD);
	if (!hasText) return undefined;
	const textValue = footer[FOOTER_TEXT_FIELD];
	if (textValue === null) return null;
	try {
		return legacyCurrentValue(
			footerType,
			requireString(textValue, FOOTER_TEXT_FIELD),
		);
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
		const footerType = parseFooterType(footer[FOOTER_TYPE_FIELD]);
		const currentValue = persistedCurrentValue(footer, footerType);
		const hasCurrentValue = currentValue !== undefined;
		if (!hasCurrentValue) return undefined;
		return {
			footerType,
			isLoading: persistedLoading(footer[FOOTER_LOADING_FIELD]),
			currentValue: currentValue ?? "",
			isVisible: currentValue !== null,
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
		const isTransientHerdrFooter =
			parsed?.footerType.id === FOOTER_HERDR_TYPE.id;
		const hasPersistedFooter = parsed !== undefined && !isTransientHerdrFooter;
		if (hasPersistedFooter) restored[parsed.footerType.id] = parsed;
	}
	return { footers: restored };
}

function serializedCurrentValue(event: FooterUpdate): string | null {
	const isVisible = event.isVisible;
	return isVisible ? event.currentValue : null;
}

export function serializeFooterState(
	state: FooterModuleState,
): PersistedFooterState {
	const footers: Record<string, PersistedFooterUpdate> = {};
	const persistedFooters = Object.values(state.footers).filter(
		(event) => event.footerType.id !== FOOTER_HERDR_TYPE.id,
	);
	for (const event of persistedFooters) {
		footers[event.footerType.id] = {
			footerType: event.footerType,
			isLoading: event.isLoading,
			currentValue: serializedCurrentValue(event),
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
			[event.footerType.id]: event,
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
