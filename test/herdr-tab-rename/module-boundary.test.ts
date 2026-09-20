import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const HERDR_SOURCES = [
	"src/herdr-tab-rename/event-consumers.ts",
	"src/herdr-tab-rename/event-publishers.ts",
	"src/herdr-tab-rename/internal-state.ts",
	"src/herdr-tab-rename/module.ts",
	"src/herdr-tab-rename/notifications.ts",
];

async function herdrSource(): Promise<string> {
	const sources = await Promise.all(
		HERDR_SOURCES.map((path) => readFile(path, "utf8")),
	);
	return sources.join("\n");
}

describe("Herdr tab rename architecture", () => {
	it("has no operation-style runtime containers or session mirrors", async () => {
		const source = await herdrSource();

		expect(source).not.toMatch(
			/currentSession|getSession|sessionStateCallback|hasStoredClaim\s*\??\s*:\s*\(/,
		);
		expect(source).not.toMatch(
			/shouldActivate|hasClaimReturnedSuccessfully|onClaimReturnedSuccessfully|withLoading|claimContext|workerCompletion|herdrBackgroundWorker|isWorkerDispatched|isWorkerReturned/,
		);
		expect(source).not.toMatch(
			/private readonly (initialLabel|tabId|paneId)|private (initialLabel|tabId|paneId)/,
		);
	});

	it("keeps only explicit state and dependency inputs in tab rename options", async () => {
		const source = await readFile(
			"src/herdr-tab-rename/internal-state.ts",
			"utf8",
		);
		const options = source.slice(
			source.indexOf("export interface HerdrTabRenameOptions"),
		);
		const optionsEnd = options.indexOf("\n}");
		const contract = options.slice(0, optionsEnd);

		expect(contract).toContain("eventHandler: EventHandler");
		expect(contract).toContain("sessionState: SessionState");
		expect(contract).not.toMatch(/context|operation|current|marker|loading/);
	});
});
