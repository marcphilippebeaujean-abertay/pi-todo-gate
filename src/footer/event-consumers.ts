import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import { publishFooterState } from "./event-publishers.ts";
import type { FooterSessionStartEvent, FooterUpdateEvent } from "./events.ts";
import {
	FooterDisplay,
	renderPrStatus,
	renderTaskStatusCompact,
} from "./footer-rendering.ts";
import type {
	FooterModule,
	FooterModuleOptions,
	FooterState,
} from "./state.ts";
import {
	applyFooterUpdate,
	emptyFooterState,
	parseFooterEvent,
} from "./state.ts";

export class FooterEventConsumer implements FooterModule {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: FooterModuleOptions["sessionState"];
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
		this.sessionState = options.sessionState;
		this.eventHandler.footerUpdateEvent.subscribe((event) =>
			this.update(event),
		);
		this.eventHandler.moduleStateChangedEvent.subscribe((event) =>
			this.refreshFromModuleState(event),
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
		event: import("../shared/events.ts").ModuleStateChangedEvent,
	): void {
		switch (event.moduleId) {
			case C.module.pr: {
				this.currentPrUrl = event.moduleState.prUrl;
				this.refreshPrStatus(this.currentPrUrl);
				return;
			}
			case C.module.worktree: {
				this.hasUncommittedChanges =
					event.gitStatePatch?.hasUncommittedChanges ??
					this.sessionState.gitState.hasUncommittedChanges ??
					false;
				this.refreshPrStatus(this.currentPrUrl);
				return;
			}
			case C.module.todoist: {
				this.currentTaskUrl = event.moduleState.taskUrl;
				this.currentTaskName = event.moduleState.taskName;
				this.refreshTaskStatus(this.currentTaskUrl, this.currentTaskName);
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

	async sessionStart(
		_event: FooterSessionStartEvent,
		nextContext: ExtensionContext,
	): Promise<void> {
		this.context = nextContext;
		this.currentPrUrl = this.sessionState.moduleState.pr.prUrl;
		this.currentTaskUrl = this.sessionState.moduleState.todoist.taskUrl;
		this.currentTaskName = this.sessionState.moduleState.todoist.taskName;
		this.hasUncommittedChanges =
			this.sessionState.gitState.hasUncommittedChanges ?? false;
		this.state = structuredClone(this.sessionState.moduleState.footer);
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
		void publishFooterState(this.eventHandler, { ...this.getState() });
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
