import { describe, expect, it } from "vitest";
import {
	buildPiWorkerArgs,
	textFromAssistantMessage,
} from "../../src/shared/pi-worker.ts";

describe("Pi worker helpers", () => {
	it("builds isolated Pi arguments with optional worker instructions", () => {
		expect(
			buildPiWorkerArgs("Fix dialog", {
				instructions: "Claim tab",
			}),
		).toEqual([
			"--mode",
			"json",
			"-p",
			"--no-extensions",
			"--no-context-files",
			"--tools",
			"bash",
			"--append-system-prompt",
			"Claim tab",
			"Fix dialog",
		]);
	});

	it("builds isolated Pi arguments with optional thinking level", () => {
		expect(buildPiWorkerArgs("Implement feature", { thinking: "low" })).toEqual(
			[
				"--mode",
				"json",
				"-p",
				"--no-extensions",
				"--no-context-files",
				"--tools",
				"bash",
				"--thinking",
				"low",
				"Implement feature",
			],
		);
	});

	it("extracts assistant text from string and multipart messages", () => {
		expect(textFromAssistantMessage({ role: "user", content: "Ignore" })).toBe(
			"",
		);
		expect(
			textFromAssistantMessage({
				role: "assistant",
				content: [
					{ type: "text", text: "first" },
					{ type: "tool_use", id: "tool-1" },
					{ type: "text", text: "second" },
				],
			}),
		).toBe("first\n\nsecond");
		expect(
			textFromAssistantMessage({ role: "assistant", content: "complete" }),
		).toBe("complete");
	});
});
