import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	FOOTER_HERDR_TYPE,
	FOOTER_SPINNER_INTERVAL_MS,
} from "../../src/footer/constants.ts";
import type { FooterLoadingEvent } from "../../src/footer/events.ts";
import { createFooterModule } from "../../src/footer/module.ts";
import type {
	FooterModuleState,
	FooterUpdate,
} from "../../src/footer/module-state.ts";
import { restoreFooterState } from "../../src/footer/module-state.ts";
import { createSharedEvents, withLoading } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

type TestFooterModule = {
	sessionStart(event: unknown, context: ExtensionContext): Promise<void>;
	update(event: unknown): void;
	setLoading(event: FooterLoadingEvent): void;
	getState(): FooterModuleState;
	deactivate(): void;
};

const createTestFooterModule = (
	options: Parameters<typeof createFooterModule>[0],
): TestFooterModule =>
	createFooterModule(options) as unknown as TestFooterModule;

function harness(branch: unknown[] = []) {
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	const context = (sessionBranch = branch) =>
		({
			cwd: "/repo",
			ui: {
				setStatus: (key: string, text: string | undefined) =>
					statusCalls.push({ key, text }),
			},
			sessionManager: { getBranch: () => sessionBranch },
		}) as unknown as ExtensionContext;
	return {
		events: createSharedEvents(),
		statusCalls,
		context,
		sessionState: createSessionState(),
	};
}

const update: FooterUpdate = {
	footerType: "pi-todo-gate-task",
	text: "Todoist Task: Fix footer |",
	isVisible: true,
};

describe("footer module", () => {
	it("clears loading through event dispatch when work fails", async () => {
		const events = createSharedEvents();
		const loading: boolean[] = [];
		events.footerLoadingEvent.subscribe(({ isLoading }) => {
			loading.push(isLoading);
		});

		await expect(
			withLoading(events, "task", async () => {
				throw new Error("failed");
			}),
		).rejects.toThrow("failed");

		expect(loading).toEqual([true, false]);
	});

	it("restores persisted footer using parsed footer type instead of map key", () => {
		expect(
			restoreFooterState({
				footers: {
					wrongKey: {
						footerType: "actual-footer",
						text: "Footer",
					},
				},
			}),
		).toEqual({
			footers: {
				"actual-footer": {
					footerType: "actual-footer",
					isLoading: false,
					text: "Footer",
					isVisible: true,
				},
			},
		});
	});

	it("starts a blank session without rendering default footers", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});

		await h.events.sessionActivatedEvent.emit({
			context: h.context(),
			sessionId: "session",
		});

		expect(h.statusCalls).toEqual([]);
		expect(footer.getState()).toEqual({ footers: {} });
	});

	it("animates loading footer text and stops after loading ends", async () => {
		vi.useFakeTimers();
		try {
			const h = harness();
			const footer = createTestFooterModule({
				eventHandler: h.events,
				getInitialState: () => h.sessionState.moduleState.footer,
			});
			await footer.sessionStart({}, h.context());

			footer.update({
				...update,
				text: "Todoist Task: ⠋ loading |",
			});
			footer.setLoading({ footerType: update.footerType, isLoading: true });
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠋ loading |");

			vi.advanceTimersByTime(FOOTER_SPINNER_INTERVAL_MS);
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠙ loading |");

			footer.update({ ...update, text: "Todoist Task: done |" });
			footer.setLoading({ footerType: update.footerType, isLoading: false });
			const callsAfterLoading = h.statusCalls.length;
			vi.advanceTimersByTime(FOOTER_SPINNER_INTERVAL_MS * 2);
			expect(h.statusCalls).toHaveLength(callsAfterLoading);
		} finally {
			vi.useRealTimers();
		}
	});

	it("updates and synchronizes visible and hidden states", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		await footer.sessionStart({}, h.context());

		footer.update(update);
		footer.update({ ...update, isVisible: false });

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
			{ key: update.footerType, text: undefined },
		]);
		expect(footer.getState()).toEqual({
			footers: {
				[update.footerType]: { ...update, isLoading: false, isVisible: false },
			},
		});
	});

	it("publishes exact module state payload for footer updates", async () => {
		const h = harness();
		const updates: unknown[] = [];
		h.events.moduleStateChangedEvent.subscribe((event) => {
			updates.push(event);
		});
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		await footer.sessionStart({}, h.context());

		footer.update(update);

		expect(updates).toEqual([
			{
				moduleId: "footer",
				moduleState: {
					footers: {
						[update.footerType]: { ...update, isLoading: false },
					},
				},
				persist: false,
			},
		]);
	});

	it("throws when live module update receives invalid data", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		await footer.sessionStart({}, h.context());

		expect(() =>
			footer.update({
				...update,
				isVisible: "true",
			} as unknown as FooterUpdate),
		).toThrow(TypeError);
	});

	it("does not derive footer statuses from module state changes", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		await footer.sessionStart({}, h.context());

		await h.events.moduleStateChangedEvent.emit({
			moduleId: "todoist",
			moduleState: { taskUrl: "https://app.todoist.com/app/task/42" },
			persist: false,
		});

		expect(footer.getState()).toEqual({ footers: {} });
	});

	it("hides Herdr spinner after explicit loading completion", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		await footer.sessionStart({}, h.context());

		footer.update({
			footerType: FOOTER_HERDR_TYPE,
			text: "Herdr: ⠋ working |",
			isVisible: true,
		});
		footer.setLoading({ footerType: FOOTER_HERDR_TYPE, isLoading: true });
		footer.setLoading({ footerType: FOOTER_HERDR_TYPE, isLoading: false });

		expect(footer.getState().footers[FOOTER_HERDR_TYPE]).toEqual({
			footerType: FOOTER_HERDR_TYPE,
			isLoading: false,
			text: "Herdr: ⠋ working |",
			isVisible: true,
		});
		expect(h.statusCalls.at(-1)).toEqual({
			key: FOOTER_HERDR_TYPE,
			text: "Herdr: ⠋ working |",
		});
	});

	it("resets in-memory state when extension instance receives a new blank session", async () => {
		const h = harness();
		const footer = createTestFooterModule({
			eventHandler: h.events,
			getInitialState: () => h.sessionState.moduleState.footer,
		});
		const firstContext = h.context();
		await footer.sessionStart({}, firstContext);
		footer.update(update);

		await footer.sessionStart({}, h.context());

		expect(footer.getState()).toEqual({ footers: {} });
		expect(h.statusCalls.at(-1)).toEqual({
			key: update.footerType,
			text: undefined,
		});
	});
});
