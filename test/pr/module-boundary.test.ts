import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("PR module boundaries", () => {
	it("removes operation containers and module-local worker mirrors", async () => {
		const sources = await Promise.all(
			[
				"src/pr/module.ts",
				"src/pr/internal-state.ts",
				"src/pr/event-consumers.ts",
				"src/pr/state-tool.ts",
			].map((path) => readFile(path, "utf8")),
		);
		for (const source of sources) {
			expect(source).not.toMatch(
				/PrOperations|operationDependencies|currentSession|PrSessionIdentity|OriginRequest|isCurrentMerge/,
			);
		}
	});

	it("keeps event orchestration in the event consumer", async () => {
		const moduleSource = await readFile("src/pr/module.ts", "utf8");
		const consumerSource = await readFile("src/pr/event-consumers.ts", "utf8");

		expect(moduleSource).not.toContain("class PrModuleImpl");
		expect(moduleSource).not.toContain("subscribeEvents");
		expect(moduleSource).not.toContain("sessionActivatedEvent.subscribe");
		expect(consumerSource).toContain("class PrConsumer");
	});
});
