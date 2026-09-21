import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewModule } from "../../src/review/module.ts";
import { createSessionState } from "../../src/state.ts";

const previousEnvironment = process.env.HERDR_ENV;

afterEach(() => {
	if (previousEnvironment === undefined) delete process.env.HERDR_ENV;
	else process.env.HERDR_ENV = previousEnvironment;
});

describe("review module", () => {
	it("does not register review command outside Herdr", () => {
		delete process.env.HERDR_ENV;
		const registerCommand = vi.fn();

		new ReviewModule({
			pi: { registerCommand } as unknown as ExtensionAPI,
			sessionState: createSessionState(),
		});

		expect(registerCommand).not.toHaveBeenCalled();
	});

	it("registers review command inside Herdr", () => {
		process.env.HERDR_ENV = "1";
		const registerCommand = vi.fn();

		new ReviewModule({
			pi: { registerCommand } as unknown as ExtensionAPI,
			sessionState: createSessionState(),
		});

		expect(registerCommand).toHaveBeenCalledWith(
			"tg_review",
			expect.objectContaining({ description: expect.any(String) }),
		);
	});
});
