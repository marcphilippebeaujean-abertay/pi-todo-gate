import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import {
	FOOTER_HERDR_TYPE,
	FOOTER_HERDR_VALUE,
	FOOTER_PR_TYPE,
	FOOTER_TASK_TYPE,
} from "./constants.ts";
import { publishFooterState } from "./event-publishers.ts";
import type { FooterType } from "./events.ts";
import {
	FooterDisplay,
	renderPrStatus,
	renderTaskStatusCompact,
} from "./footer-rendering.ts";
import type { FooterModuleOptions } from "./internal-state.ts";
import type { FooterEntryState, FooterModuleState } from "./module-state.ts";
import { emptyFooterState } from "./module-state.ts";

export class FooterEventConsumer {
	private readonly eventHandler: EventHandler;
	private readonly getSessionState: FooterModuleOptions["getSessionState"];
	private context: Pick<ExtensionContext, "ui" | "sessionManager"> | null =
		null;
	private state = emptyFooterState();
	private readonly loading = new Set<string>();
	private readonly footerDisplay = new FooterDisplay();

	constructor(options: FooterModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.getSessionState = options.getSessionState;
		this.eventHandler.actionLoadingEvent.subscribe((event) => {
			const isLoading = event.isLoading;
			if (isLoading) this.loading.add(event.action);
			else this.loading.delete(event.action);
			this.project(this.getSessionState());
		});
		this.eventHandler.sessionStateChangedEvent.subscribe(({ currentState }) =>
			this.project(currentState),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(({ context }) =>
			this.sessionStart(context),
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	async sessionStart(nextContext: ExtensionContext): Promise<void> {
		this.context = nextContext;
		this.project(this.getSessionState(), true);
	}

	private project(
		sessionState: ReturnType<FooterModuleOptions["getSessionState"]>,
		force?: boolean,
	): void {
		const next = this.deriveState(sessionState);
		const unchanged = JSON.stringify(this.state) === JSON.stringify(next);
		const shouldForce = force ?? false;
		const shouldSkip = unchanged && !shouldForce;
		if (shouldSkip) return;
		this.state = next;
		const currentContext = this.context;
		const shouldSkipProjection = currentContext === null;
		if (shouldSkipProjection) return;
		this.footerDisplay.start(currentContext, this.state);
		void publishFooterState(this.eventHandler, this.state);
	}

	private deriveState(
		sessionState: ReturnType<FooterModuleOptions["getSessionState"]>,
	): FooterModuleState {
		const footers: Record<string, FooterEntryState> = {};
		const isGitProject = sessionState.gitState.isGitProject === true;
		const currentContext = this.context;
		const shouldProjectGitFooters = isGitProject && currentContext !== null;
		if (shouldProjectGitFooters) {
			const theme = currentContext.ui.theme;
			this.addFooter(
				footers,
				FOOTER_PR_TYPE,
				renderPrStatus(
					sessionState.moduleState.pr.prUrl,
					theme,
					sessionState.gitState.hasUncommittedChanges ?? false,
				),
				C.action.pr,
			);
			this.addFooter(
				footers,
				FOOTER_TASK_TYPE,
				renderTaskStatusCompact(
					sessionState.moduleState.todoist.taskUrl,
					theme,
					sessionState.moduleState.todoist.taskName,
				),
				C.action.task,
			);
		}
		const isHerdrLoading = this.loading.has(C.action.herdrTabRename);
		if (isHerdrLoading)
			this.addFooter(
				footers,
				FOOTER_HERDR_TYPE,
				FOOTER_HERDR_VALUE,
				C.action.herdrTabRename,
			);
		return { footers };
	}

	private addFooter(
		footers: Record<string, FooterEntryState>,
		footerType: FooterType,
		currentValue: string,
		action: string,
	): void {
		footers[footerType.id] = {
			footerType,
			currentValue,
			isVisible: true,
			isLoading: this.loading.has(action),
		};
	}

	getState(): FooterModuleState {
		return structuredClone(this.state);
	}

	deactivate(): void {
		this.loading.clear();
		this.footerDisplay.deactivate();
		this.context = null;
		this.state = emptyFooterState();
	}
}
