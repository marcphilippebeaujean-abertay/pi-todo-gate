import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { FOOTER_CUSTOM_ENTRY_TYPE, FOOTER_STATE_TYPE } from "./constants.ts";
import { FooterDisplay } from "./display.ts";
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

function customEntryData(entry: unknown, customType: string): unknown {
	const isObject = typeof entry === "object";
	if (!isObject) return undefined;
	const isNull = entry === null;
	if (isNull) return undefined;
	const isArray = Array.isArray(entry);
	if (isArray) return undefined;
	const candidate = entry as {
		type?: unknown;
		customType?: unknown;
		data?: unknown;
	};
	const isCustomEntry = candidate.type === FOOTER_CUSTOM_ENTRY_TYPE;
	if (!isCustomEntry) return undefined;
	const hasRequestedType = candidate.customType === customType;
	if (!hasRequestedType) return undefined;
	return candidate.data;
}

function latestFooterState(entries: readonly unknown[]): FooterState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const data = customEntryData(entries[index], FOOTER_STATE_TYPE);
		const hasData = data !== undefined;
		if (!hasData) continue;
		const state = restoreFooterState(data);
		const hasState = state !== null;
		if (hasState) return state;
	}
	return null;
}

class FooterModuleImpl implements FooterModule {
	private context: SessionContext | null = null;
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
		event: { previousSessionFile?: string },
		nextContext: ExtensionContext,
	): Promise<void> {
		this.context = nextContext;
		this.state = emptyFooterState();
		const currentState = latestFooterState(
			nextContext.sessionManager.getBranch(),
		);
		const hasCurrentState = currentState !== null;
		if (hasCurrentState) {
			this.state = currentState;
			this.display.start(nextContext, this.state);
			return;
		}
		const previousSessionFile = event.previousSessionFile;
		const hasPreviousSession = previousSessionFile !== undefined;
		if (!hasPreviousSession) {
			this.display.start(nextContext, this.state);
			return;
		}
		const previous =
			this.dependencies.openSession?.(previousSessionFile) ??
			SessionManager.open(previousSessionFile);
		const inherited = latestFooterState(previous.getBranch());
		const hasInheritedState = inherited !== null;
		if (hasInheritedState) {
			this.state = inherited;
			this.appendState();
		}
		this.display.start(nextContext, this.state);
	}

	update(event: FooterUpdate): void {
		const parsed = parseFooterEvent(event);
		const hasContext = this.context !== null;
		if (!hasContext) return;
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

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies: FooterModuleDependencies = {},
): FooterModule {
	return new FooterModuleImpl(pi, dependencies);
}
