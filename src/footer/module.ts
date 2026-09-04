import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { appendCustomState } from "../shared/session-state.ts";
import {
	FOOTER_SPINNER_FRAMES,
	FOOTER_SPINNER_INTERVAL_MS,
	FOOTER_STATE_TYPE,
} from "./constants.ts";
import { parseFooterEvent } from "./events.ts";
import {
	applyFooterUpdate,
	emptyFooterState,
	restoreFooterState,
	serializeFooterState,
} from "./state.ts";
import type { FooterState, FooterUpdate } from "./types.ts";

export interface FooterSessionReader {
	getBranch(): unknown[];
}

export interface FooterModuleDependencies {
	openSession?: (path: string) => FooterSessionReader;
}

export interface FooterModule {
	sessionStart(
		event: { previousSessionFile?: string },
		ctx: ExtensionContext,
	): Promise<void>;
	update(event: FooterUpdate): void;
	getState(): FooterState;
	deactivate(): void;
}

type SessionContext = Pick<ExtensionContext, "ui" | "sessionManager">;
type AnimationTimer = ReturnType<typeof setInterval>;

function customEntryData(entry: unknown, customType: string): unknown {
	if (typeof entry !== "object") return undefined;
	if (entry === null) return undefined;
	if (Array.isArray(entry)) return undefined;
	const candidate = entry as {
		type?: unknown;
		customType?: unknown;
		data?: unknown;
	};
	if (candidate.type !== "custom") return undefined;
	if (candidate.customType !== customType) return undefined;
	return candidate.data;
}

function latestFooterState(entries: readonly unknown[]): FooterState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const data = customEntryData(entries[index], FOOTER_STATE_TYPE);
		if (data === undefined) continue;
		const state = restoreFooterState(data);
		if (state) return state;
	}
	return null;
}

function loadingText(text: string, frame: string): string {
	return text.replace(FOOTER_SPINNER_FRAMES[0], frame);
}

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies: FooterModuleDependencies = {},
): FooterModule {
	let context: SessionContext | null = null;
	let state = emptyFooterState();
	let renderedFooterTypes = new Set<string>();
	const animations = new Map<string, AnimationTimer>();

	const appendState = (): void => {
		appendCustomState(
			(type, data) => pi.appendEntry(type, data),
			FOOTER_STATE_TYPE,
			serializeFooterState(state),
		);
	};

	const stopAnimation = (footerType: string): void => {
		const timer = animations.get(footerType);
		if (!timer) return;
		clearInterval(timer);
		animations.delete(footerType);
	};

	const setVisual = (
		runContext: SessionContext,
		event: FooterUpdate,
		text = event.text,
	): void => {
		renderedFooterTypes.add(event.footerType);
		try {
			runContext.ui.setStatus(
				event.footerType,
				event.isVisible ? text : undefined,
			);
		} catch {
			// Headless modes may not expose status UI.
		}
	};

	const syncEvent = (runContext: SessionContext, event: FooterUpdate): void => {
		stopAnimation(event.footerType);
		setVisual(runContext, event);
		if (!event.isLoading || !event.isVisible) return;

		let frameIndex = 0;
		const timer = setInterval(() => {
			const current = state.footers[event.footerType];
			if (
				!current ||
				current !== event ||
				!current.isLoading ||
				!current.isVisible
			) {
				stopAnimation(event.footerType);
				return;
			}
			frameIndex = (frameIndex + 1) % FOOTER_SPINNER_FRAMES.length;
			setVisual(
				runContext,
				current,
				loadingText(current.text, FOOTER_SPINNER_FRAMES[frameIndex]),
			);
		}, FOOTER_SPINNER_INTERVAL_MS);
		animations.set(event.footerType, timer);
	};

	const clearVisuals = (runContext: SessionContext | null): void => {
		for (const footerType of animations.keys()) stopAnimation(footerType);
		if (!runContext) return;
		for (const footerType of renderedFooterTypes) {
			try {
				runContext.ui.setStatus(footerType, undefined);
			} catch {
				// Headless modes may not expose status UI.
			}
		}
		renderedFooterTypes = new Set<string>();
	};

	const syncState = (runContext: SessionContext): void => {
		for (const event of Object.values(state.footers))
			syncEvent(runContext, event);
	};

	return {
		async sessionStart(event, nextContext) {
			clearVisuals(context);
			context = nextContext;
			state = emptyFooterState();

			const currentState = latestFooterState(
				nextContext.sessionManager.getBranch(),
			);
			if (currentState) state = currentState;
			else if (event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const inherited = latestFooterState(previous.getBranch());
				if (inherited) {
					state = inherited;
					appendState();
				}
			}
			syncState(nextContext);
		},
		update(event) {
			const parsed = parseFooterEvent(event);
			if (!context) return;
			state = applyFooterUpdate(state, parsed);
			appendState();
			syncEvent(context, parsed);
		},
		getState() {
			return {
				footers: Object.fromEntries(
					Object.entries(state.footers).map(([key, event]) => [
						key,
						{ ...event },
					]),
				),
			};
		},
		deactivate() {
			clearVisuals(context);
			context = null;
			state = emptyFooterState();
		},
	};
}
