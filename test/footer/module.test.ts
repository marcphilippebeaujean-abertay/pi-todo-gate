import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	FOOTER_SPINNER_INTERVAL_MS,
	FOOTER_STATE_TYPE,
} from "../../src/footer/constants.ts";
import { createFooterModule } from "../../src/footer/module.ts";
import { restoreFooterState } from "../../src/footer/state.ts";
import type { FooterUpdate } from "../../src/footer/types.ts";

function harness(branch: unknown[] = []) {
	const appended: unknown[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	const pi = {
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
	} as unknown as ExtensionAPI;
	const context = (sessionBranch = branch) =>
		({
			cwd: "/repo",
			ui: {
				setStatus: (key: string, text: string | undefined) =>
					statusCalls.push({ key, text }),
			},
			sessionManager: { getBranch: () => sessionBranch },
		}) as unknown as ExtensionContext;
	return { pi, appended, statusCalls, context };
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
		const footer = createFooterModule(h.pi);

		await footer.sessionStart({}, h.context());

		expect(h.statusCalls).toEqual([]);
		expect(h.appended).toEqual([]);
		expect(footer.getState()).toEqual({ footers: {} });
	});

	it("animates loading footer text and stops after loading ends", async () => {
		vi.useFakeTimers();
		try {
			const h = harness();
			const footer = createFooterModule(h.pi);
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

	it("persists updates and synchronizes visible and hidden states", async () => {
		const h = harness();
		const footer = createFooterModule(h.pi);
		await footer.sessionStart({}, h.context());

		footer.update(update);
		footer.update({ ...update, isVisible: false });

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
			{ key: update.footerType, text: undefined },
		]);
		expect(h.appended).toEqual([
			{
				type: FOOTER_STATE_TYPE,
				data: {
					footers: {
						[update.footerType]: {
							footerType: update.footerType,
							isLoading: update.isLoading,
							text: update.text,
						},
					},
				},
			},
			{
				type: FOOTER_STATE_TYPE,
				data: {
					footers: {
						[update.footerType]: {
							footerType: update.footerType,
							isLoading: update.isLoading,
							text: null,
						},
					},
				},
			},
		]);
		expect(footer.getState()).toEqual({
			footers: { [update.footerType]: { ...update, isVisible: false } },
		});
	});

	it("throws when live module update receives invalid data", async () => {
		const h = harness();
		const footer = createFooterModule(h.pi);
		await footer.sessionStart({}, h.context());

		expect(() =>
			footer.update({
				...update,
				isVisible: "true",
			} as unknown as FooterUpdate),
		).toThrow(TypeError);
	});

	it("restores footer state from current session during resume", async () => {
		const h = harness([
			{
				type: "custom",
				customType: FOOTER_STATE_TYPE,
				data: {
					footers: {
						[update.footerType]: {
							footerType: update.footerType,
							isLoading: update.isLoading,
							text: update.text,
						},
					},
				},
			},
		]);
		const footer = createFooterModule(h.pi);

		await footer.sessionStart({}, h.context());

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
		]);
		expect(h.appended).toEqual([]);
	});

	it("restarts spinner for a restored loading footer", async () => {
		vi.useFakeTimers();
		try {
			const h = harness([
				{
					type: "custom",
					customType: FOOTER_STATE_TYPE,
					data: {
						footers: {
							[update.footerType]: {
								footerType: update.footerType,
								isLoading: true,
								text: "Todoist Task: ⠋ loading |",
							},
						},
					},
				},
			]);
			const footer = createFooterModule(h.pi);

			await footer.sessionStart({}, h.context());
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠋ loading |");

			vi.advanceTimersByTime(FOOTER_SPINNER_INTERVAL_MS);
			expect(h.statusCalls.at(-1)?.text).toBe("Todoist Task: ⠙ loading |");
			footer.deactivate();
		} finally {
			vi.useRealTimers();
		}
	});

	it("inherits footer state from previous session during /new", async () => {
		const previous = [
			{
				type: "custom",
				customType: FOOTER_STATE_TYPE,
				data: {
					footers: {
						[update.footerType]: {
							footerType: update.footerType,
							isLoading: update.isLoading,
							text: update.text,
						},
					},
				},
			},
		];
		const h = harness();
		const footer = createFooterModule(h.pi, {
			openSession: () => ({ getBranch: () => previous }),
		});

		await footer.sessionStart(
			{ previousSessionFile: "/sessions/previous.jsonl" },
			h.context(),
		);

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
		]);
		expect(h.appended).toEqual([
			{
				type: FOOTER_STATE_TYPE,
				data: {
					footers: {
						[update.footerType]: {
							footerType: update.footerType,
							isLoading: update.isLoading,
							text: update.text,
						},
					},
				},
			},
		]);
	});

	it("resets in-memory state when extension instance receives a new blank session", async () => {
		const h = harness();
		const footer = createFooterModule(h.pi);
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
