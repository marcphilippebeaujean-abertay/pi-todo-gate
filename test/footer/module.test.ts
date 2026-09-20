import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	FOOTER_HERDR_TYPE,
	FOOTER_PR_TYPE,
	FOOTER_TASK_TYPE,
} from "../../src/footer/constants.ts";
import { FooterModule } from "../../src/footer/module.ts";
import { EXTENSION_CONSTANTS as C } from "../../src/shared/constants.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

function context(): ExtensionContext {
	return {
		cwd: "/repo",
		ui: { setStatus: () => undefined },
		sessionManager: { getBranch: () => [] },
	} as unknown as ExtensionContext;
}

function observeFooterState(
	events: ReturnType<typeof createSharedEvents>,
	sessionState: ReturnType<typeof createSessionState>,
): void {
	events.moduleStateChangedEvent.subscribe((update) => {
		if (update.moduleId !== C.module.footer) return;
		sessionState.moduleState.footer = update.moduleState;
	});
}

function publicState(sessionState: ReturnType<typeof createSessionState>) {
	return sessionState.moduleState.footer;
}

describe("footer module", () => {
	it("projects PR and Todoist values for Git projects", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		observeFooterState(events, sessionState);
		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		sessionState.moduleState.todoist.taskName = "Fix task";
		new FooterModule({
			eventHandler: events,
			getSessionState: () => sessionState,
		});

		await events.sessionActivatedEvent.emit({
			context: context(),
			previousSessionFile: undefined,
			sessionId: "session",
			session: { project: { isGitProject: true } } as never,
		});

		const state = publicState(sessionState);
		expect(state.footers[FOOTER_PR_TYPE.id]).toMatchObject({ isVisible: true });
		expect(state.footers[FOOTER_TASK_TYPE.id]).toMatchObject({
			isVisible: true,
		});
	});

	it("hides PR and Todoist outside Git projects", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		observeFooterState(events, sessionState);
		new FooterModule({
			eventHandler: events,
			getSessionState: () => sessionState,
		});
		await events.sessionActivatedEvent.emit({
			context: context(),
			previousSessionFile: undefined,
			sessionId: "session",
		});

		expect(publicState(sessionState).footers).not.toHaveProperty(
			FOOTER_PR_TYPE.id,
		);
		expect(publicState(sessionState).footers).not.toHaveProperty(
			FOOTER_TASK_TYPE.id,
		);
	});

	it("shows Herdr only while rename action is loading", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		observeFooterState(events, sessionState);
		new FooterModule({
			eventHandler: events,
			getSessionState: () => sessionState,
		});
		await events.sessionActivatedEvent.emit({
			context: context(),
			previousSessionFile: undefined,
			sessionId: "session",
			session: { project: { isGitProject: true } } as never,
		});

		await events.actionLoadingEvent.emit({
			action: C.action.herdrTabRename,
			isLoading: true,
		});
		expect(
			publicState(sessionState).footers[FOOTER_HERDR_TYPE.id],
		).toMatchObject({
			isVisible: true,
			isLoading: true,
		});
		await events.actionLoadingEvent.emit({
			action: C.action.herdrTabRename,
			isLoading: false,
		});
		expect(publicState(sessionState).footers).not.toHaveProperty(
			FOOTER_HERDR_TYPE.id,
		);
	});
});
