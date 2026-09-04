import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { FOOTER_STATE_TYPE } from "./constants.ts";
import { isFooterUpdate } from "./events.ts";
import { applyFooterUpdate, emptyFooterState, isFooterState } from "./state.ts";
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

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies: FooterModuleDependencies = {},
): FooterModule {
	let context: SessionContext | null = null;
	let state = emptyFooterState();
	let renderedFooterTypes = new Set<string>();

	const appendState = (): void => {
		appendCustomState(
			(type, data) => pi.appendEntry(type, data),
			FOOTER_STATE_TYPE,
			state,
		);
	};

	const setVisual = (runContext: SessionContext, event: FooterUpdate): void => {
		renderedFooterTypes.add(event.footerType);
		try {
			runContext.ui.setStatus(
				event.footerType,
				event.isVisible ? event.text : undefined,
			);
		} catch {
			// Headless modes may not expose status UI.
		}
	};

	const clearVisuals = (runContext: SessionContext | null): void => {
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
			if (event.isVisible) setVisual(runContext, event);
	};

	return {
		async sessionStart(event, nextContext) {
			clearVisuals(context);
			context = nextContext;
			state = emptyFooterState();

			const currentState = latestCustomState(
				nextContext.sessionManager.getBranch(),
				FOOTER_STATE_TYPE,
				isFooterState,
			);
			if (currentState) state = currentState;
			else if (event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const inherited = latestCustomState(
					previous.getBranch(),
					FOOTER_STATE_TYPE,
					isFooterState,
				);
				if (inherited) {
					state = inherited;
					appendState();
				}
			}
			syncState(nextContext);
		},
		update(event) {
			if (!context || !isFooterUpdate(event)) return;
			state = applyFooterUpdate(state, event);
			appendState();
			setVisual(context, event);
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
