import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PR module boundaries", () => {
	it("keeps event orchestration in the event consumer", async () => {
		const moduleSource = await readFile("src/pr/module.ts", "utf8");
		const consumerSource = await readFile("src/pr/event-consumers.ts", "utf8");

		expect(moduleSource).not.toContain("class PrModuleImpl");
		expect(moduleSource).not.toContain("subscribeEvents");
		expect(moduleSource).not.toContain("sessionActivatedEvent.subscribe");
		expect(consumerSource).toContain("class PrConsumer");
	});
});
