import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Todoist module boundaries", () => {
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
