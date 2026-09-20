import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Todoist module boundaries", () => {
	it("removes operation containers and module-local mirrors", async () => {
		const sources = await Promise.all(
			[
				"src/todoist/module.ts",
				"src/todoist/internal-state.ts",
				"src/todoist/commands.ts",
				"src/todoist/completion.ts",
				"src/todoist/event-consumers.ts",
			].map((path) => readFile(path, "utf8")),
		);
		for (const source of sources) {
			expect(source).not.toMatch(
				/TodoistOperations|operationDependencies|currentProjectRef|pendingProjects|taskClaim\.pending|taskClaim\.completed/,
			);
		}
	});

	it("keeps EventHandler subscriptions in event-consumers.ts", async () => {
		const moduleSource = await readFile("src/todoist/module.ts", "utf8");
		const consumerSource = await readFile(
			"src/todoist/event-consumers.ts",
			"utf8",
		);

		expect(moduleSource).not.toContain(".subscribe(");
		expect(consumerSource).toContain(".subscribe(");
	});
});
