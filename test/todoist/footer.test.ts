import { describe, expect, it } from "vitest";
import { renderTaskStatus } from "../../src/todoist/footer.ts";

const styledTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

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

	it("renders a missing task safely", () => {
		expect(renderTaskStatus(undefined, styledTheme)).toContain(
			"<muted>Todoist Task: </muted><text>none</text><muted> |</muted>",
		);
	});
});
