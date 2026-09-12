import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FooterSessionStartEvent, FooterUpdateEvent } from "./events.ts";

export type FooterUpdate = FooterUpdateEvent;
export type FooterEventSink = (event: FooterUpdateEvent) => void;

import {
	requireBoolean,
	requireNonEmptyString,
	requireRecord,
	requireString,
} from "../shared/validation.ts";
import {
	FOOTER_EVENT_LABEL,
	FOOTER_FOOTERS_LABEL,
	FOOTER_LOADING_FIELD,
	FOOTER_PERSISTED_LABEL,
	FOOTER_STATE_LABEL,
	FOOTER_TEXT_FIELD,
	FOOTER_TYPE_FIELD,
	FOOTER_VISIBLE_FIELD,
} from "./constants.ts";

export interface FooterState {
	footers: Record<string, FooterUpdate>;
}

export interface PersistedFooterUpdate {
	footerType: string;
	isLoading?: boolean;
	text: string | null;
}

export interface PersistedFooterState {
	footers: Record<string, PersistedFooterUpdate>;
}

export interface FooterSessionReader {
	getBranch(): unknown[];
}
export interface FooterModuleDependencies {
	openSession?: (path: string) => FooterSessionReader;
}
export interface FooterModule {
	sessionStart(
		event: FooterSessionStartEvent,
		ctx: ExtensionContext,
	): Promise<void>;
	update(event: FooterUpdate): void;
	getState(): FooterState;
	deactivate(): void;
}
export type FooterModuleFactory = (
	pi: ExtensionAPI,
	dependencies?: FooterModuleDependencies,
) => FooterModule;

export type FooterSessionContext = {
	ui: {
		setStatus(key: string, text: string | undefined): void;
	};
};
export type AnimationTimer = ReturnType<typeof setInterval>;
export interface FooterAnimation {
	timer: AnimationTimer | null;
	event: FooterUpdate;
	frameIndex: number;
}
export interface FooterRenderState {
	prUrl?: string;
	taskUrl?: string;
	taskName?: string;
	branch?: string | null;
}
export interface FooterTheme {
	fg(color: string, text: string): string;
}
export interface FooterData {
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getGitBranch?(): string | null | undefined;
	onBranchChange(listener: () => void): () => void;
}
export interface FooterTui {
	requestRender(): void;
}
export interface FooterComponent {
	dispose(): void;
	invalidate(): void;
	render(width: number): string[];
}
export type FooterFactory = (
	tui: FooterTui,
	theme: FooterTheme,
	footerData: FooterData,
) => FooterComponent;
export interface TodoistFooterTheme {
	fg(color: string, text: string): string;
}

export interface FooterEntry {
	readonly isVisible: boolean;
	update(event: FooterUpdate): void;
	render(): string;
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

function serializedText(event: FooterUpdate): string | null {
	const isVisible = event.isVisible;
	if (!isVisible) return null;
	return event.text;
}

export function serializeFooterState(state: FooterState): PersistedFooterState {
	const footers: Record<string, PersistedFooterUpdate> = {};
	for (const event of Object.values(state.footers)) {
		footers[event.footerType] = {
			footerType: event.footerType,
			isLoading: event.isLoading,
			text: serializedText(event),
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
