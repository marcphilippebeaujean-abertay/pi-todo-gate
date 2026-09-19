import { describe, expect, it } from "vitest";
import {
	FOOTER_HERDR_TYPE,
	FOOTER_PR_TYPE,
	FOOTER_TASK_TYPE,
} from "../../src/footer/constants.ts";
import {
	type FooterModuleState as FooterState,
	type FooterUpdate,
	footerStateDescriptor,
	parseFooterEvent,
	restoreFooterState,
	serializeFooterState,
} from "../../src/footer/module-state.ts";

const visible: FooterUpdate = {
	footerType: FOOTER_TASK_TYPE,
	isLoading: true,
	currentValue: "work",
	isVisible: true,
};

const hidden: FooterUpdate = {
	footerType: FOOTER_HERDR_TYPE,
	isLoading: false,
	currentValue: "working",
	isVisible: false,
};

describe("footer state", () => {
	it("provides common session-state descriptor", () => {
		const state: FooterState = {
			footers: {
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					isLoading: false,
					currentValue: "Task",
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
	it("serializes current values and omits Herdr", () => {
		const state: FooterState = {
			footers: {
				[FOOTER_TASK_TYPE.id]: visible,
				[FOOTER_HERDR_TYPE.id]: hidden,
			},
		};

		expect(serializeFooterState(state)).toEqual({
			footers: {
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					isLoading: true,
					currentValue: "work",
				},
			},
		});
	});

	it("does not persist or restore active Herdr footer status", () => {
		const state: FooterState = {
			footers: {
				[FOOTER_HERDR_TYPE.id]: {
					footerType: FOOTER_HERDR_TYPE,
					isLoading: true,
					currentValue: "working",
					isVisible: true,
				},
				[FOOTER_TASK_TYPE.id]: visible,
			},
		};

		const snapshot = serializeFooterState(state);
		expect(restoreFooterState(snapshot)).toEqual({
			footers: { [FOOTER_TASK_TYPE.id]: visible },
		});
	});

	it("restores legacy text entries into named footer values", () => {
		expect(
			restoreFooterState({
				footers: {
					pr: {
						footerType: FOOTER_PR_TYPE.id,
						text: "| PR Link: none |",
					},
					task: {
						footerType: FOOTER_TASK_TYPE.id,
						text: "Todoist Task: Task |",
					},
				},
			}),
		).toEqual({
			footers: {
				[FOOTER_PR_TYPE.id]: {
					footerType: FOOTER_PR_TYPE,
					isLoading: false,
					currentValue: "none",
					isVisible: true,
				},
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					isLoading: false,
					currentValue: "Task",
					isVisible: true,
				},
			},
		});
	});
});
