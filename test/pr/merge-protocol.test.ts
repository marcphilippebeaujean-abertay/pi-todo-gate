import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mergeProtocolSkillPath } from "../../src/prompt-queue/module.ts";

describe("merge protocol skill", () => {
	it("declares safe, user-confirmed merge workflow", async () => {
		const skill = await readFile(`${mergeProtocolSkillPath}/SKILL.md`, "utf8");
		expect(skill).toContain("name: merge-protocol");
		expect(skill).toContain(
			"description: Guides safe, user-confirmed pull request merging",
		);
		expect(skill).toContain("gh pr merge <url> --merge");
		expect(skill).toContain("Do not complete Todoist directly");
		expect(skill).toContain("pinned PR URL");
		expect(skill).toContain("explicit confirmation");
		expect(skill).toContain("prMerged");
	});

	it("has no input pattern trigger", async () => {
		const extension = await readFile("src/pr/event-consumers.ts", "utf8");
		expect(extension).not.toContain('pi.on("input"');
		expect(extension).not.toContain("shouldTriggerMergeProtocol");
	});
});
