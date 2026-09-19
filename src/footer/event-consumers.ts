import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	EventHandler,
	ModuleStateChangedEvent,
} from "../shared/events.ts";
import { publishFooterState } from "./event-publishers.ts";
import type {
	FooterLoadingEvent,
	FooterSessionStartEvent,
	FooterUpdateEvent,
} from "./events.ts";
import { FooterDisplay } from "./footer-rendering.ts";
import type { FooterModuleOptions } from "./internal-state.ts";
import type { FooterModuleState as FooterState } from "./module-state.ts";
import {
	applyFooterLoading,
	applyFooterUpdate,
	emptyFooterState,
	parseFooterEvent,
	parseFooterLoadingEvent,
} from "./module-state.ts";

export class FooterEventConsumer {
	private readonly eventHandler: EventHandler;
	private readonly getInitialState: FooterModuleOptions["getInitialState"];
	private context: Pick<ExtensionContext, "ui" | "sessionManager"> | null =
		null;
	private state = emptyFooterState();
	private readonly display = new FooterDisplay();

	constructor(options: FooterModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.getInitialState = options.getInitialState;
		this.eventHandler.moduleStateChangedEvent.subscribe((event) =>
			this.refreshFromModuleState(event),
		);
		this.eventHandler.footerUpdateEvent.subscribe((event) =>
			this.update(event),
		);
		this.eventHandler.footerLoadingEvent.subscribe((event) =>
			this.setLoading(event),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, previousSessionFile }) =>
				this.sessionStart({ previousSessionFile }, context),
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	private refreshFromModuleState(event: ModuleStateChangedEvent): void {
		const isFooterUpdate = event.moduleId === C.module.footer;
		if (!isFooterUpdate) return;
		const hasSameState =
			JSON.stringify(this.state) === JSON.stringify(event.moduleState);
		if (hasSameState) return;
		this.state = structuredClone(event.moduleState);
		const hasContext = this.context !== null;
		if (!hasContext) return;
		for (const footer of Object.values(this.state.footers))
			this.display.update(this.state, footer);
	}

	async sessionStart(
		_event: FooterSessionStartEvent,
		nextContext: ExtensionContext,
	): Promise<void> {
		this.context = nextContext;
		this.state = structuredClone(this.getInitialState());
		this.display.start(nextContext, this.state);
	}

	update(event: FooterUpdateEvent, force?: boolean): void {
		const parsed = parseFooterEvent(event);
		const hasContext = this.context !== null;
		if (!hasContext) return;
		const previous = this.state.footers[parsed.footerType];
		const hasPrevious = previous !== undefined;
		const sameText = hasPrevious && previous.text === parsed.text;
		const sameVisibility =
			hasPrevious && previous.isVisible === parsed.isVisible;
		const isUnchanged = sameText && sameVisibility;
		const shouldForce = force ?? false;
		const shouldSkip = isUnchanged && !shouldForce;
		if (shouldSkip) return;
		this.state = applyFooterUpdate(this.state, parsed);
		void publishFooterState(this.eventHandler, { ...this.getState() });
		this.display.update(this.state, this.state.footers[parsed.footerType]);
	}

	setLoading(event: FooterLoadingEvent): void {
		const parsed = parseFooterLoadingEvent(event);
		const hasContext = this.context !== null;
		if (!hasContext) return;
		const current = this.state.footers[parsed.footerType];
		const hasCurrent = current !== undefined;
		if (!hasCurrent) return;
		const isLoadingUnchanged = current.isLoading === parsed.isLoading;
		if (isLoadingUnchanged) return;
		this.state = applyFooterLoading(this.state, parsed);
		void publishFooterState(this.eventHandler, { ...this.getState() });
		this.display.update(this.state, this.state.footers[parsed.footerType]);
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
