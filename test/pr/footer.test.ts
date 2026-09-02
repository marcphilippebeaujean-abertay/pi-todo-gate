import { describe, expect, it } from "vitest";
import { renderPrLabel, renderPrStatus } from "../../src/pr/footer.ts";

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

	it("renders invalid PR values safely", () => {
		expect(renderPrStatus("https://example.com/pr/42", styledTheme)).toContain(
			"PR Link: ",
		);
	});
});
