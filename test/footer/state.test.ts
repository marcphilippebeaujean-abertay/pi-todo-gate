import { describe, expect, it } from "vitest";
import { parseFooterEvent } from "../../src/footer/events.ts";
import {
	restoreFooterState,
	serializeFooterState,
} from "../../src/footer/state.ts";
import type { FooterState, FooterUpdate } from "../../src/footer/types.ts";

const visible: FooterUpdate = {
	footerType: "task",
	isLoading: true,
	text: "Todoist Task: work |",
	isVisible: true,
};

const hidden: FooterUpdate = {
	footerType: "herdr",
	isLoading: false,
	text: "Herdr: working |",
	isVisible: false,
};

describe("footer event parsing", () => {
	it("returns an exact live event object", () => {
		expect(parseFooterEvent({ ...visible, ignored: "drop me" })).toEqual(
			visible,
		);
	});

	it("throws when live event contract is invalid", () => {
		expect(() => parseFooterEvent({ ...visible, isLoading: "true" })).toThrow(
			TypeError,
		);
	});
});

describe("footer state serialization", () => {
	it("omits visibility and serializes hidden events with null text", () => {
		const state: FooterState = { footers: { task: visible, herdr: hidden } };

		expect(serializeFooterState(state)).toEqual({
			footers: {
				task: {
					footerType: "task",
					isLoading: true,
					text: "Todoist Task: work |",
				},
				herdr: {
					footerType: "herdr",
					isLoading: false,
					text: null,
				},
			},
		});
	});

	it("skips malformed records and derives visibility on restore", () => {
		expect(
			restoreFooterState({
				footers: {
					valid: {
						footerType: "task",
						text: "Task",
					},
					hidden: {
						footerType: "herdr",
						text: null,
					},
					badType: { footerType: 42, text: "ignored" },
					missingText: { footerType: "missing" },
					badText: { footerType: "bad-text", text: 42 },
				},
			}),
		).toEqual({
			footers: {
				task: {
					footerType: "task",
					isLoading: false,
					text: "Task",
					isVisible: true,
				},
				herdr: {
					footerType: "herdr",
					isLoading: false,
					text: "",
					isVisible: false,
				},
			},
		});
	});
});
