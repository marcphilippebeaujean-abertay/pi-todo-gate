import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { FOOTER_CUSTOM_ENTRY_TYPE, FOOTER_STATE_TYPE } from "./constants.ts";
import type { FooterSessionStartEvent, FooterUpdateEvent } from "./events.ts";
import { FooterDisplay } from "./footer-rendering.ts";
import type {
	FooterModule,
	FooterModuleDependencies,
	FooterState,
} from "./state.ts";
import {
	applyFooterUpdate,
	emptyFooterState,
	parseFooterEvent,
	restoreFooterState,
	serializeFooterState,
} from "./state.ts";

function customEntryData(entry: unknown, customType: string): unknown {
	if (typeof entry !== "object") return undefined;
	if (entry === null) return undefined;
	if (Array.isArray(entry)) return undefined;
	const candidate = entry as {
		type?: unknown;
		customType?: unknown;
		data?: unknown;
	};
	const hasCustomType = candidate.type === FOOTER_CUSTOM_ENTRY_TYPE;
	if (!hasCustomType) return undefined;
	const matchesCustomType = candidate.customType === customType;
	if (!matchesCustomType) return undefined;
	return candidate.data;
}

function latestFooterState(entries: readonly unknown[]): FooterState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const data = customEntryData(entries[index], FOOTER_STATE_TYPE);
		if (data === undefined) continue;
		const state = restoreFooterState(data);
		if (state !== null) return state;
	}
	return null;
}

export class FooterEventConsumer implements FooterModule {
	private context: Pick<ExtensionContext, "ui" | "sessionManager"> | null =
		null;
	private state = emptyFooterState();
	private readonly display = new FooterDisplay();

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly dependencies: FooterModuleDependencies,
	) {}

	private appendState(): void {
		this.pi.appendEntry(FOOTER_STATE_TYPE, serializeFooterState(this.state));
	}

	async sessionStart(
		event: FooterSessionStartEvent,
		nextContext: ExtensionContext,
	): Promise<void> {
		this.context = nextContext;
		this.state = emptyFooterState();
		const currentState = latestFooterState(
			nextContext.sessionManager.getBranch(),
		);
		if (currentState !== null) {
			this.state = currentState;
			this.display.start(nextContext, this.state);
			return;
		}
		if (event.previousSessionFile === undefined) {
			this.display.start(nextContext, this.state);
			return;
		}
		const previous =
			this.dependencies.openSession?.(event.previousSessionFile) ??
			SessionManager.open(event.previousSessionFile);
		const inherited = latestFooterState(previous.getBranch());
		if (inherited !== null) {
			this.state = inherited;
			this.appendState();
		}
		this.display.start(nextContext, this.state);
	}

	update(event: FooterUpdateEvent): void {
		const parsed = parseFooterEvent(event);
		if (this.context === null) return;
		this.state = applyFooterUpdate(this.state, parsed);
		this.appendState();
		this.display.update(this.state, parsed);
	}

	getState(): FooterState {
		return {
			footers: Object.fromEntries(
				Object.entries(this.state.footers).map(([key, event]) => [
					key,
					{ ...event },
				]),
			),
		};
	}

	deactivate(): void {
		this.display.deactivate();
		this.context = null;
		this.state = emptyFooterState();
	}
}
