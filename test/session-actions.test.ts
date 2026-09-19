import { describe, expect, it, vi } from "vitest";
import { runSessionAction } from "../src/shared/session-actions.ts";

describe("runSessionAction", () => {
	it("skips stale action and awaits notification", async () => {
		const action = vi.fn();
		const notifySkipped = vi.fn(async () => undefined);

		const result = await runSessionAction(() => false, action, notifySkipped);

		expect(result).toEqual({ started: false, currentAfterAction: false });
		expect(action).not.toHaveBeenCalled();
		expect(notifySkipped).toHaveBeenCalledOnce();
	});

	it("runs current action and reports current result", async () => {
		const action = vi.fn(async () => "done");

		const result = await runSessionAction(() => true, action, vi.fn());

		expect(result).toEqual({
			started: true,
			value: "done",
			currentAfterAction: true,
		});
		expect(action).toHaveBeenCalledOnce();
	});

	it("reports session transition during action without changing started state", async () => {
		let current = true;
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const action = vi.fn(async () => {
			current = false;
			await blocked;
			return "done";
		});

		const resultPromise = runSessionAction(() => current, action, vi.fn());
		release();

		expect(await resultPromise).toEqual({
			started: true,
			value: "done",
			currentAfterAction: false,
		});
	});

	it("propagates action errors", async () => {
		const error = new Error("failed");
		const action = vi.fn(async () => {
			throw error;
		});

		await expect(runSessionAction(() => true, action, vi.fn())).rejects.toBe(
			error,
		);
	});
});
