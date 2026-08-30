import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	createFooterFactory,
	type FooterTheme,
	renderFooterLine,
} from "../src/footer.ts";
import { renderPrLabel, renderPrStatus } from "../src/pr/footer.ts";
import { renderTaskStatus } from "../src/todoist/footer.ts";

const theme: FooterTheme = { fg: (_color, text) => text };
const statuses = new Map([["caveman", "Caveman: ready"]]);
const styledTheme: FooterTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
};

describe("PR footer rendering", () => {
	it("styles status labels separately from clickable values", () => {
		const pr = renderPrStatus(
			"https://github.com/owner/repo/pull/42",
			styledTheme,
		);
		const task = renderTaskStatus(
			"https://app.todoist.com/app/task/7",
			styledTheme,
			"Implement feature",
		);
		expect(pr).toContain("<muted>| PR Link: </muted>");
		expect(pr).toContain("\u001b[4m<accent>#42</accent>\u001b[24m");
		expect(pr).toContain("<muted> |</muted>");
		expect(task).toContain("<muted>Todoist Task: </muted>");
		expect(task).toContain(
			"\u001b[4m<accent>Implement featu...</accent>\u001b[24m",
		);
		expect(task).not.toContain("#7");
	});

	it("renders clickable PR labels from PR footer module", () => {
		const pr = renderPrLabel(
			"https://github.com/owner/repo/pull/42",
			styledTheme,
		);
		expect(pr).toContain("PR #42");
		expect(pr).toContain("\u001b]8;;https://github.com/owner/repo/pull/42");
	});
});

describe("renderFooterLine", () => {
	it("truncates long task names after 15 characters", () => {
		const task = renderTaskStatus(
			"https://app.todoist.com/app/task/7",
			styledTheme,
			"12345678901234567890",
		);
		expect(task).toContain("123456789012345...");
		expect(task).not.toContain("12345678901234567890");
	});

	it("renders clickable PR and task labels", () => {
		const line = renderFooterLine(
			{
				prUrl: "https://github.com/owner/repo/pull/42",
				taskUrl: "https://app.todoist.com/app/task/7",
				taskName: "Implement feature",
				branch: "feature/auth",
			},
			120,
			theme,
			statuses,
		);
		expect(line).toContain("PR #42");
		expect(line).toContain("Todoist Task");
		expect(line).toContain("Implement featu...");
		expect(line).toContain("feature/auth");
		expect(line).toContain("\u001b]8;;https://github.com/owner/repo/pull/42");
		expect(line).toContain("\u001b]8;;https://app.todoist.com/app/task/7");
		expect(line).toContain("Caveman: ready");
	});

	it("renders explicit missing values", () => {
		const line = renderFooterLine({}, 80, theme, new Map());
		expect(line).toContain("PR: none");
		expect(line).toContain("Todoist Task: none");
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
