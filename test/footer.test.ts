import { describe, expect, it } from "vitest";
import { renderPrLabel, renderPrStatus } from "../src/pr/footer.ts";
import { renderTaskStatus } from "../src/todoist/footer.ts";

const styledTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

describe("PR footer rendering", () => {
	it("renders a linked PR status", () => {
		const status = renderPrStatus(
			"https://github.com/owner/repo/pull/42",
			styledTheme,
		);
		expect(status).toContain("<muted>| PR Link: </muted>");
		expect(status).toContain("#42");
		expect(status).toContain("\u001b]8;;https://github.com/owner/repo/pull/42");
	});

	it("renders a linked PR label", () => {
		const label = renderPrLabel(
			"https://github.com/owner/repo/pull/42",
			styledTheme,
		);
		expect(label).toContain("PR #42");
	});
});

describe("Todoist footer rendering", () => {
	it("renders a linked task with a bounded name", () => {
		const status = renderTaskStatus(
			"https://app.todoist.com/app/task/7",
			styledTheme,
			"12345678901234567890",
		);
		expect(status).toContain("123456789012345...");
		expect(status).not.toContain("12345678901234567890");
		expect(status).toContain("\u001b]8;;https://app.todoist.com/app/task/7");
	});

	it("renders missing task and invalid PR values safely", () => {
		expect(renderTaskStatus(undefined, styledTheme)).toContain(
			"<muted>Todoist Task: </muted><text>none</text><muted> |</muted>",
		);
		expect(renderPrStatus("https://example.com/pr/42", styledTheme)).toContain(
			"PR Link: ",
		);
	});
});
