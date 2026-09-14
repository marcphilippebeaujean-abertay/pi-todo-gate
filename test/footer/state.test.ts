import { describe, expect, it } from "vitest";
import { FOOTER_HERDR_TYPE } from "../../src/footer/constants.ts";
import {
	type FooterState,
	type FooterUpdate,
	footerStateDescriptor,
	parseFooterEvent,
	restoreFooterState,
	serializeFooterState,
} from "../../src/footer/internal-state.ts";

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

describe("footer state", () => {
	it("provides common session-state descriptor", () => {
		const state: FooterState = {
			footers: {
				task: {
					footerType: "task",
					isLoading: false,
					text: "Task",
					isVisible: true,
				},
			},
		};

		expect(footerStateDescriptor.id).toBe("footer");
		expect(
			footerStateDescriptor.restore(footerStateDescriptor.serialize(state)),
		).toEqual(state);
	});
});

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

	it("does not persist or restore active Herdr footer status", () => {
		const state: FooterState = {
			footers: {
				[FOOTER_HERDR_TYPE]: {
					footerType: FOOTER_HERDR_TYPE,
					isLoading: true,
					text: "Herdr: ⠋ working |",
					isVisible: true,
				},
				task: visible,
			},
		};

		const snapshot = serializeFooterState(state);
		expect(snapshot).toEqual({
			footers: {
				task: {
					footerType: "task",
					isLoading: true,
					text: "Todoist Task: work |",
				},
			},
		});
		expect(restoreFooterState(snapshot)).toEqual({
			footers: { task: visible },
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
