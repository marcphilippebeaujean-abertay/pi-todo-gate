import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { FOOTER_SPINNER_INTERVAL_MS } from "../../src/footer/constants.ts";
import { createFooterModule } from "../../src/footer/module.ts";
import type { FooterUpdate } from "../../src/footer/state.ts";
import { restoreFooterState } from "../../src/footer/state.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

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
	isLoading: false,
	text: "Todoist Task: Fix footer |",
	isVisible: true,
};

describe("footer module", () => {
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
		const footer = createFooterModule({
			eventHandler: h.events,
			sessionState: h.sessionState,
		});

		await footer.sessionStart({}, h.context());

		expect(h.statusCalls).toEqual([]);
		expect(footer.getState()).toEqual({ footers: {} });
	});

	it("animates loading footer text and stops after loading ends", async () => {
		vi.useFakeTimers();
		try {
			const h = harness();
			const footer = createFooterModule({
				eventHandler: h.events,
				sessionState: h.sessionState,
			});
			await footer.sessionStart({}, h.context());

			footer.update({
				...update,
				isLoading: true,
				text: "Todoist Task: ⠋ loading |",
			});
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠋ loading |");

			vi.advanceTimersByTime(FOOTER_SPINNER_INTERVAL_MS);
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠙ loading |");

			footer.update({ ...update, text: "Todoist Task: done |" });
			const callsAfterLoading = h.statusCalls.length;
			vi.advanceTimersByTime(FOOTER_SPINNER_INTERVAL_MS * 2);
			expect(h.statusCalls).toHaveLength(callsAfterLoading);
		} finally {
			vi.useRealTimers();
		}
	});

	it("updates and synchronizes visible and hidden states", async () => {
		const h = harness();
		const footer = createFooterModule({
			eventHandler: h.events,
			sessionState: h.sessionState,
		});
		await footer.sessionStart({}, h.context());

		footer.update(update);
		footer.update({ ...update, isVisible: false });

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
			{ key: update.footerType, text: undefined },
		]);
		expect(footer.getState()).toEqual({
			footers: { [update.footerType]: { ...update, isVisible: false } },
		});
	});

	it("publishes exact module state payload for footer updates", async () => {
		const h = harness();
		const updates: unknown[] = [];
		h.events.moduleStateChangedEvent.subscribe((event) => {
			updates.push(event);
		});
		const footer = createFooterModule({
			eventHandler: h.events,
			sessionState: h.sessionState,
		});
		await footer.sessionStart({}, h.context());

		footer.update(update);

		expect(updates).toEqual([
			{
				moduleId: "footer",
				moduleState: { footers: { [update.footerType]: update } },
				persist: false,
			},
		]);
	});

	it("throws when live module update receives invalid data", async () => {
		const h = harness();
		const footer = createFooterModule({
			eventHandler: h.events,
			sessionState: h.sessionState,
		});
		await footer.sessionStart({}, h.context());

		expect(() =>
			footer.update({
				...update,
				isVisible: "true",
			} as unknown as FooterUpdate),
		).toThrow(TypeError);
	});

	it("consumes typed footer updates through shared event channel", async () => {
		const h = harness();
		const events = createSharedEvents();
		const footer = createFooterModule({
			eventHandler: events,
			sessionState: h.sessionState,
		});
		await footer.sessionStart({}, h.context());

		await events.footerUpdateEvent.emit(update);

		expect(footer.getState()).toEqual({
			footers: { [update.footerType]: update },
		});
		expect(h.statusCalls.at(-1)).toEqual({
			key: update.footerType,
			text: update.text,
		});
	});

	it("resets in-memory state when extension instance receives a new blank session", async () => {
		const h = harness();
		const footer = createFooterModule({
			eventHandler: h.events,
			sessionState: h.sessionState,
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
