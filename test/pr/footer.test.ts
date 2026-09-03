const STYLES_FOOTER_LABELS_SEPARATELY_FROM_CLICKABLE_VALUES =
	"styles footer labels separately from clickable values";
const HTTPS_GITHUB_COM_OWNER_REPO_PULL_42 =
	"https://github.com/owner/repo/pull/42";
const HTTPS_APP_TODOIST_COM_APP_TASK_7 = "https://app.todoist.com/app/task/7";
const IMPLEMENT_FEATURE = "Implement feature";
const MUTED_PR_LINK_MUTED = "<muted>| PR Link: </muted>";
const VALUE_4_M_ACCENT_42_ACCENT_24_M =
	"\u001b[4m<accent>#42</accent>\u001b[24m";
const MUTED_MUTED = "<muted> |</muted>";
const MUTED_TODOIST_TASK_MUTED = "<muted>Todoist Task: </muted>";
const VALUE_4_M_ACCENT_IMPLEMENT_FEATU_ACCENT_24 =
	"\u001b[4m<accent>Implement featu...</accent>\u001b[24m";
const VALUE_7 = "#7";
const TRUNCATES_LONG_TASK_NAMES_AFTER_15_CHARACTERS =
	"truncates long task names after 15 characters";
const VALUE_12345678901234567890 = "12345678901234567890";
const VALUE_123456789012345 = "123456789012345...";
const RENDERS_CLICKABLE_PR_AND_TASK_LABELS =
	"renders clickable PR and task labels";
const FEATURE_AUTH = "feature/auth";
const PR_42 = "PR #42";
const TODOIST_TASK = "Todoist Task";
const IMPLEMENT_FEATU = "Implement featu...";
const VALUE_8_HTTPS_GITHUB_COM_OWNER_REPO_PULL =
	"\u001b]8;;https://github.com/owner/repo/pull/42";
const VALUE_8_HTTPS_APP_TODOIST_COM_APP_TASK =
	"\u001b]8;;https://app.todoist.com/app/task/7";
const CAVEMAN_READY = "Caveman: ready";
const RENDERS_EXPLICIT_MISSING_VALUES = "renders explicit missing values";
const PR_NONE = "PR: none";
const TODOIST_TASK_NONE = "Todoist Task: none";
const KEEPS_LABELS_BOUNDED_FOR_LONG_URLS_AND =
	"keeps labels bounded for long URLs and narrow widths";
const HTTPS_GITHUB_COM_OWNER_REPO_PULL_123456789 =
	"https://github.com/owner/repo/pull/123456789";
const HTTPS_APP_TODOIST_COM_APP_TASK_123456789 =
	"https://app.todoist.com/app/task/123456789";
const A_VERY_LONG_BRANCH_NAME = "a-very-long-branch-name";
const VALUE_123456789 = "123456789";
const RENDERS_CURRENT_STATE_AND_REQUESTS_REFRESH_ON =
	"renders current state and requests refresh on branch changes";
const MAIN = "main";
const FEATURE = "feature";

import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
	createFooterFactory,
	type FooterTheme,
	renderFooterLine,
	renderPrStatus,
	renderTaskStatus,
} from "../../src/footer.ts";

const theme: FooterTheme = { fg: (_color, text) => text };
const statuses = new Map([["caveman", "Caveman: ready"]]);
const styledTheme: FooterTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
};

describe("renderFooterLine", () => {
	it(STYLES_FOOTER_LABELS_SEPARATELY_FROM_CLICKABLE_VALUES, () => {
		const pr = renderPrStatus(HTTPS_GITHUB_COM_OWNER_REPO_PULL_42, styledTheme);
		const task = renderTaskStatus(
			HTTPS_APP_TODOIST_COM_APP_TASK_7,
			styledTheme,
			IMPLEMENT_FEATURE,
		);
		expect(pr).toContain(MUTED_PR_LINK_MUTED);
		expect(pr).toContain(VALUE_4_M_ACCENT_42_ACCENT_24_M);
		expect(pr).toContain(MUTED_MUTED);
		expect(task).toContain(MUTED_TODOIST_TASK_MUTED);
		expect(task).toContain(VALUE_4_M_ACCENT_IMPLEMENT_FEATU_ACCENT_24);
		expect(task).not.toContain(VALUE_7);
	});

	it(TRUNCATES_LONG_TASK_NAMES_AFTER_15_CHARACTERS, () => {
		const task = renderTaskStatus(
			HTTPS_APP_TODOIST_COM_APP_TASK_7,
			styledTheme,
			VALUE_12345678901234567890,
		);
		expect(task).toContain(VALUE_123456789012345);
		expect(task).not.toContain(VALUE_12345678901234567890);
	});

	it(RENDERS_CLICKABLE_PR_AND_TASK_LABELS, () => {
		const line = renderFooterLine(
			{
				prUrl: HTTPS_GITHUB_COM_OWNER_REPO_PULL_42,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_7,
				taskName: IMPLEMENT_FEATURE,
				branch: FEATURE_AUTH,
			},
			120,
			theme,
			statuses,
		);
		expect(line).toContain(PR_42);
		expect(line).toContain(TODOIST_TASK);
		expect(line).toContain(IMPLEMENT_FEATU);
		expect(line).toContain(FEATURE_AUTH);
		expect(line).toContain(VALUE_8_HTTPS_GITHUB_COM_OWNER_REPO_PULL);
		expect(line).toContain(VALUE_8_HTTPS_APP_TODOIST_COM_APP_TASK);
		expect(line).toContain(CAVEMAN_READY);
	});

	it(RENDERS_EXPLICIT_MISSING_VALUES, () => {
		const line = renderFooterLine({}, 80, theme, new Map());
		expect(line).toContain(PR_NONE);
		expect(line).toContain(TODOIST_TASK_NONE);
	});

	it(KEEPS_LABELS_BOUNDED_FOR_LONG_URLS_AND, () => {
		const line = renderFooterLine(
			{
				prUrl: HTTPS_GITHUB_COM_OWNER_REPO_PULL_123456789,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_123456789,
				branch: A_VERY_LONG_BRANCH_NAME,
			},
			24,
			theme,
			statuses,
		);
		expect(visibleWidth(line)).toBeLessThanOrEqual(24);
		expect(stripTerminalSequences(line)).not.toContain(VALUE_123456789);
	});
});

describe("createFooterFactory", () => {
	it(RENDERS_CURRENT_STATE_AND_REQUESTS_REFRESH_ON, () => {
		let state = { branch: MAIN };
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
		expect(component.render(80)[0]).toContain(MAIN);
		state = { branch: FEATURE };
		branchListener?.();
		expect(refreshes).toBe(1);
		expect(component.render(80)[0]).toContain(FEATURE);
		component.invalidate();
		component.dispose();
	});
});
