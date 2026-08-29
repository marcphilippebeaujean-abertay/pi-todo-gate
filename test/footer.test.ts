import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	createFooterFactory,
	type FooterTheme,
	renderFooterLine,
} from "../src/footer.ts";

const theme: FooterTheme = { fg: (_color, text) => text };
const statuses = new Map([["caveman", "Caveman: ready"]]);

describe("renderFooterLine", () => {
	it("renders clickable PR and task labels", () => {
		const line = renderFooterLine(
			{
				prUrl: "https://github.com/owner/repo/pull/42",
				taskUrl: "https://app.todoist.com/app/task/7",
				branch: "feature/auth",
			},
			120,
			theme,
			statuses,
		);
		expect(line).toContain("PR #42");
		expect(line).toContain("Task");
		expect(line).toContain("feature/auth");
		expect(line).toContain("\u001b]8;;https://github.com/owner/repo/pull/42");
		expect(line).toContain("\u001b]8;;https://app.todoist.com/app/task/7");
		expect(line).toContain("Caveman: ready");
	});

	it("renders explicit missing values", () => {
		const line = renderFooterLine({}, 80, theme, new Map());
		expect(line).toContain("PR: none");
		expect(line).toContain("Task: none");
	});

	it("keeps labels bounded for long URLs and narrow widths", () => {
		const line = renderFooterLine(
			{
				prUrl: "https://github.com/owner/repo/pull/123456789",
				taskUrl: "https://app.todoist.com/app/task/123456789",
				branch: "a-very-long-branch-name",
			},
			24,
			theme,
			statuses,
		);
		expect(visibleWidth(line)).toBeLessThanOrEqual(24);
		expect(stripTerminalSequences(line)).not.toContain("123456789");
	});
});

describe("createFooterFactory", () => {
	it("renders current state and requests refresh on branch changes", () => {
		let state = { branch: "main" };
		let refreshes = 0;
		let branchListener: (() => void) | undefined;
		const factory = createFooterFactory(() => state);
		const component = factory(
			{
				requestRender: () => {
					refreshes += 1;
				},
			},
			theme,
			{
				getExtensionStatuses: () => statuses,
				onBranchChange: (listener) => {
					branchListener = listener;
					return () => {
						branchListener = undefined;
					};
				},
			},
		);
		expect(component.render(80)[0]).toContain("main");
		state = { branch: "feature" };
		branchListener?.();
		expect(refreshes).toBe(1);
		expect(component.render(80)[0]).toContain("feature");
		component.invalidate();
		component.dispose();
	});
});
