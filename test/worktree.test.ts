import { describe, expect, it } from "vitest";
import { hasNoSessionWork } from "../src/worktree/module.ts";

describe("worktree session baseline", () => {
	it("detects clean unchanged worktree as no work", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: "" },
				{ currentHead: "abc", currentStatus: "" },
			),
		).toBe(true);
	});

	it("treats a new commit as work", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: "" },
				{ currentHead: "def", currentStatus: "" },
			),
		).toBe(false);
	});

	it.each(["?? new.txt", " M file.ts", "M  staged.ts"])(
		"treats status %s as work",
		(initialStatus) => {
			expect(
				hasNoSessionWork(
					{ initialHead: "abc", initialStatus: "" },
					{ currentHead: "abc", currentStatus: initialStatus },
				),
			).toBe(false);
		},
	);

	it("treats an initially dirty worktree as work even after cleanup", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: " M file.ts" },
				{ currentHead: "abc", currentStatus: "" },
			),
		).toBe(false);
	});
});
