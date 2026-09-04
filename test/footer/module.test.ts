import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { FOOTER_STATE_TYPE } from "../../src/footer/constants.ts";
import { createFooterModule } from "../../src/footer/module.ts";
import { isFooterState } from "../../src/footer/state.ts";
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
	it("rejects persisted states whose keys do not match footer types", () => {
		expect(
			isFooterState({
				footers: {
					wrongKey: { ...update, footerType: "actual-footer" },
				},
			}),
		).toBe(false);
	});

	it("starts a blank session without rendering default footers", async () => {
		const h = harness();
		const footer = createFooterModule(h.pi);

		await footer.sessionStart({}, h.context());

		expect(h.statusCalls).toEqual([]);
		expect(h.appended).toEqual([]);
		expect(footer.getState()).toEqual({ footers: {} });
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
				data: { footers: { [update.footerType]: update } },
			},
			{
				type: FOOTER_STATE_TYPE,
				data: {
					footers: { [update.footerType]: { ...update, isVisible: false } },
				},
			},
		]);
		expect(footer.getState()).toEqual({
			footers: { [update.footerType]: { ...update, isVisible: false } },
		});
	});

	it("restores footer state from current session during resume", async () => {
		const h = harness([
			{
				type: "custom",
				customType: FOOTER_STATE_TYPE,
				data: { footers: { [update.footerType]: update } },
			},
		]);
		const footer = createFooterModule(h.pi);

		await footer.sessionStart({}, h.context());

		expect(h.statusCalls).toEqual([
			{ key: update.footerType, text: update.text },
		]);
		expect(h.appended).toEqual([]);
	});

	it("inherits footer state from previous session during /new", async () => {
		const previous = [
			{
				type: "custom",
				customType: FOOTER_STATE_TYPE,
				data: { footers: { [update.footerType]: update } },
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
				data: { footers: { [update.footerType]: update } },
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
