import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ModuleContext } from "../shared/module-context.ts";
import type { SessionContext } from "../state.ts";
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
import type { FooterModule, FooterModuleDependencies } from "./state.ts";

export * from "./events.ts";
export * from "./footer-rendering.ts";
export * from "./state.ts";
export { renderPrStatus, renderTaskStatusCompact as renderTodoistTaskStatus };

export function refreshFooterStatuses(
	footer: FooterModule,
	session: SessionContext,
): void {
	footer.update({
		footerType: C.status.pr,
		isLoading: false,
		text: renderPrStatus(
			session.state.prUrl,
			session.context.ui.theme,
			session.hasUncommittedChanges,
		),
		isVisible: true,
	});
	footer.update({
		footerType: C.status.task,
		isLoading: false,
		text: renderTaskStatusCompact(
			session.state.taskUrl,
			session.context.ui.theme,
			session.state.taskName,
		),
		isVisible: true,
	});
}

export function updateWorkingTreeStatus(
	footer: FooterModule,
	session: SessionContext,
	hasUncommittedChanges: boolean,
): void {
	const hasStatusChanged =
		session.hasUncommittedChanges !== hasUncommittedChanges;
	session.hasUncommittedChanges = hasUncommittedChanges;
	if (hasStatusChanged) refreshFooterStatuses(footer, session);
}

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies?: FooterModuleDependencies,
	moduleContext?: ModuleContext,
): FooterModule {
	return new FooterEventConsumer(pi, dependencies ?? {}, moduleContext);
}
