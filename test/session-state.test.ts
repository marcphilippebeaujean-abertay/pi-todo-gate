import { describe, expect, it } from "vitest";
import {
	appendCustomState,
	latestCustomState,
} from "../src/shared/session-state.ts";

describe("shared session state", () => {
	it("reads only the requested custom state type", () => {
		const entries = [
			{ type: "custom", customType: "pi-pr-gate-state", data: { prUrl: "pr" } },
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "task" },
			},
		];

		expect(
			latestCustomState(
				entries,
				"pi-pr-gate-state",
				(value): value is Record<string, unknown> =>
					typeof value === "object" && value !== null && !Array.isArray(value),
			),
		).toEqual({ prUrl: "pr" });
	});

	it("writes the requested custom type and payload unchanged", () => {
		const appended: Array<{ customType: string; data: { taskRef: string } }> =
			[];

		appendCustomState(
			(customType, data) => appended.push({ customType, data }),
			"pi-todoist-gate-state",
			{ taskRef: "task" },
		);

		expect(appended).toEqual([
			{ customType: "pi-todoist-gate-state", data: { taskRef: "task" } },
		]);
	});
});
