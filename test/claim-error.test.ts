import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { handleClaimError } from "../src/claim-error.ts";

const HERDR = "Herdr";
const TODOIST = "Todoist";
const ERROR = "worker unavailable";
const WARNING_LEVEL = "warning";

function context() {
	return { ui: { notify: vi.fn() } };
}

describe("claim error handler", () => {
	it.each([
		[
			HERDR,
			`Warning: Herdr claim worker completed without claim evidence/ran into an error (${ERROR})`,
		],
		[
			TODOIST,
			`Warning: Todoist claim worker completed without claim evidence/ran into an error (${ERROR})`,
		],
	])("templates %s warning", (jobType, message) => {
		const ctx = context();
		handleClaimError(ctx as unknown as Pick<ExtensionContext, "ui">, {
			jobType: jobType as "Herdr" | "Todoist",
			error: ERROR,
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith(message, WARNING_LEVEL);
	});
});
