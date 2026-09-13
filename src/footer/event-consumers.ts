import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import { FOOTER_CUSTOM_ENTRY_TYPE, FOOTER_STATE_TYPE } from "./constants.ts";
import type { FooterSessionStartEvent, FooterUpdateEvent } from "./events.ts";
import {
	FooterDisplay,
	renderPrStatus,
	renderTaskStatusCompact,
} from "./footer-rendering.ts";
import type {
	FooterModule,
	FooterModuleDependencies,
	FooterModuleOptions,
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
	private readonly eventHandler: EventHandler;
	private readonly pi: ExtensionAPI;
	private readonly dependencies: FooterModuleDependencies;
	private context: Pick<ExtensionContext, "ui" | "sessionManager"> | null =
		null;
	private state = emptyFooterState();
	private currentPrUrl: string | undefined;
	private currentTaskUrl: string | undefined;
	private currentTaskName: string | undefined;
	private hasUncommittedChanges = false;
	private readonly display = new FooterDisplay();

	constructor(options: FooterModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.pi = options.pi;
		this.dependencies = options.dependencies ?? {};
		this.eventHandler.footerUpdateEvent.subscribe((event) =>
			this.update(event),
		);
		this.eventHandler.moduleStateChangedEvent.subscribe((event) =>
			this.refreshFromModuleState(event.moduleId, event.moduleState),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, previousSessionFile }) =>
				this.sessionStart({ previousSessionFile }, context),
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	private refreshFromModuleState(
		moduleId: string,
		moduleState: Record<string, unknown>,
	): void {
		switch (moduleId) {
			case C.module.pr: {
				const pr = moduleState as { prUrl?: string };
				this.currentPrUrl = pr.prUrl;
				this.refreshPrStatus(pr.prUrl);
				return;
			}
			case C.module.worktree: {
				const worktree = moduleState as { hasUncommittedChanges?: boolean };
				this.hasUncommittedChanges = worktree.hasUncommittedChanges ?? false;
				this.refreshPrStatus(this.currentPrUrl);
				return;
			}
			case C.module.todoist: {
				const todoist = moduleState as {
					taskUrl?: string;
					taskName?: string;
				};
				this.currentTaskUrl = todoist.taskUrl;
				this.currentTaskName = todoist.taskName;
				this.refreshTaskStatus(todoist.taskUrl, todoist.taskName);
				return;
			}
			default:
				return;
		}
	}

	private refreshPrStatus(url?: string): void {
		if (this.context === null) return;
		this.update({
			footerType: C.status.pr,
			isLoading: false,
			text: renderPrStatus(
				url,
				this.context.ui.theme,
				this.hasUncommittedChanges,
			),
			isVisible: true,
		});
		this.refreshTaskStatus(this.currentTaskUrl, this.currentTaskName, true);
	}

	private refreshTaskStatus(
		url?: string,
		taskName?: string,
		force?: boolean,
	): void {
		if (this.context === null) return;
		const shouldForce = force ?? false;
		this.update(
			{
				footerType: C.status.task,
				isLoading: false,
				text: renderTaskStatusCompact(url, this.context.ui.theme, taskName),
				isVisible: true,
			},
			shouldForce,
		);
	}

	private appendState(): void {
		this.pi.appendEntry(FOOTER_STATE_TYPE, serializeFooterState(this.state));
	}

	async sessionStart(
		event: FooterSessionStartEvent,
		nextContext: ExtensionContext,
	): Promise<void> {
		this.context = nextContext;
		this.currentPrUrl = undefined;
		this.currentTaskUrl = undefined;
		this.currentTaskName = undefined;
		this.hasUncommittedChanges = false;
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

	update(event: FooterUpdateEvent, force?: boolean): void {
		const parsed = parseFooterEvent(event);
		if (this.context === null) return;
		const previous = this.state.footers[parsed.footerType];
		const hasPrevious = previous !== undefined;
		const sameLoading = hasPrevious && previous.isLoading === parsed.isLoading;
		const sameText = hasPrevious && previous.text === parsed.text;
		const sameVisibility =
			hasPrevious && previous.isVisible === parsed.isVisible;
		const sameCore = sameLoading && sameText;
		const isUnchanged = sameCore && sameVisibility;
		const shouldForce = force ?? false;
		const shouldSkip = isUnchanged && !shouldForce;
		if (shouldSkip) return;
		this.state = applyFooterUpdate(this.state, parsed);
		void this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.footer,
			moduleState: { ...this.getState() },
		});
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
		this.currentPrUrl = undefined;
		this.currentTaskUrl = undefined;
		this.currentTaskName = undefined;
		this.hasUncommittedChanges = false;
		this.state = emptyFooterState();
	}
}
