import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { SessionState } from "../state.ts";
import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import "./footer-rendering.ts";
import { FooterEventConsumer } from "./event-consumers.ts";
import { renderPrStatus, renderTaskStatusCompact } from "./footer-rendering.ts";
import type { FooterModule, FooterModuleOptions } from "./state.ts";

export * from "./events.ts";
export * from "./footer-rendering.ts";
export * from "./state.ts";
export { renderPrStatus, renderTaskStatusCompact as renderTodoistTaskStatus };

export function refreshFooterStatuses(
	footer: FooterModule,
	sessionState: SessionState,
	context: ExtensionContext,
): void {
	footer.update({
		footerType: C.status.pr,
		isLoading: false,
		text: renderPrStatus(
			sessionState.moduleState.pr.prUrl,
			context.ui.theme,
			sessionState.gitState.hasUncommittedChanges ?? false,
		),
		isVisible: true,
	});
	footer.update({
		footerType: C.status.task,
		isLoading: false,
		text: renderTaskStatusCompact(
			sessionState.moduleState.todoist.taskUrl,
			context.ui.theme,
			sessionState.moduleState.todoist.taskName,
		),
		isVisible: true,
	});
}

export function updateWorkingTreeStatus(
	footer: FooterModule,
	sessionState: SessionState,
	context: ExtensionContext,
	hasUncommittedChanges: boolean,
): void {
	const hasStatusChanged =
		sessionState.gitState.hasUncommittedChanges !== hasUncommittedChanges;
	if (!hasStatusChanged) return;
	const nextState: SessionState = {
		...sessionState,
		gitState: { ...sessionState.gitState, hasUncommittedChanges },
	};
	refreshFooterStatuses(footer, nextState, context);
}

export function createFooterModule(options: FooterModuleOptions): FooterModule {
	return new FooterEventConsumer(options);
}
