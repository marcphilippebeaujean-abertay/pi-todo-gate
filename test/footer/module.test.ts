import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	FOOTER_HERDR_TYPE,
	FOOTER_PR_TYPE,
	FOOTER_TASK_TYPE,
} from "../../src/footer/constants.ts";
import { createFooterModule } from "../../src/footer/module.ts";
import type { emptyFooterState } from "../../src/footer/module-state.ts";
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

function publicState(footer: ReturnType<typeof createFooterModule>) {
	return (
		footer as unknown as { getState: () => ReturnType<typeof emptyFooterState> }
	).getState();
}

describe("footer module", () => {
	it("projects PR and Todoist values for Git projects", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		sessionState.moduleState.todoist.taskName = "Fix task";
		const footer = createFooterModule({
			eventHandler: events,
			getSessionState: () => sessionState,
		});

		await events.sessionActivatedEvent.emit({
			context: context(),
			previousSessionFile: undefined,
			sessionId: "session",
			session: { project: { isGitProject: true } } as never,
		});

		const state = publicState(footer);
		expect(state.footers[FOOTER_PR_TYPE.id]).toMatchObject({ isVisible: true });
		expect(state.footers[FOOTER_TASK_TYPE.id]).toMatchObject({
			isVisible: true,
		});
	});

	it("hides PR and Todoist outside Git projects", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		const footer = createFooterModule({
			eventHandler: events,
			getSessionState: () => sessionState,
		});
		await events.sessionActivatedEvent.emit({
			context: context(),
			previousSessionFile: undefined,
			sessionId: "session",
		});

		expect(publicState(footer).footers).not.toHaveProperty(FOOTER_PR_TYPE.id);
		expect(publicState(footer).footers).not.toHaveProperty(FOOTER_TASK_TYPE.id);
	});

	it("shows Herdr only while rename action is loading", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		const footer = createFooterModule({
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
		expect(publicState(footer).footers[FOOTER_HERDR_TYPE.id]).toMatchObject({
			isVisible: true,
			isLoading: true,
		});
		await events.actionLoadingEvent.emit({
			action: C.action.herdrTabRename,
			isLoading: false,
		});
		expect(publicState(footer).footers).not.toHaveProperty(
			FOOTER_HERDR_TYPE.id,
		);
	});
});
