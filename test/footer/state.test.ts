import { describe, expect, it } from "vitest";
import { FOOTER_TASK_TYPE } from "../../src/footer/constants.ts";
import {
	type FooterModuleState,
	parseFooterEvent,
	restoreFooterState,
	serializeFooterState,
} from "../../src/footer/module-state.ts";

describe("footer state", () => {
	it("parses value events without loading state", () => {
		expect(
			parseFooterEvent({
				footerType: FOOTER_TASK_TYPE,
				currentValue: "Task",
				isVisible: true,
			}),
		).toEqual({
			footerType: FOOTER_TASK_TYPE,
			currentValue: "Task",
			isVisible: true,
		});
	});

	it("does not persist transient loading", () => {
		const state: FooterModuleState = {
			footers: {
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					currentValue: "Task",
					isVisible: true,
					isLoading: true,
				},
			},
		};
		expect(serializeFooterState(state)).toEqual({
			footers: {
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					currentValue: "Task",
				},
			},
		});
		expect(restoreFooterState(serializeFooterState(state))).toEqual({
			footers: {
				[FOOTER_TASK_TYPE.id]: {
					footerType: FOOTER_TASK_TYPE,
					currentValue: "Task",
					isVisible: true,
					isLoading: false,
				},
			},
		});
	});
});
