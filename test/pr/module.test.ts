import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { createPrModule } from "../../src/pr/module.ts";
import { prStateDescriptor } from "../../src/pr/module-state.ts";
import {
	firstUnmergedGithubPrUrl,
	markRemindersDelivered,
	recordMergedPr,
	removeMergedPr,
} from "../../src/pr/parsing.ts";
import { createEventHandler } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

const PR_42 = "https://github.com/o/r/pull/42";

function result(stdout = "", code = 0) {
	return { stdout, stderr: "", code };
}

describe("PR module state", () => {
	it("restores and serializes durable PR state", () => {
		const state = {
			prUrl: PR_42,
			discoveryDisabled: true,
			discoveryTestedUrls: ["one", "one"],
			mergedPrs: [],
		};
		expect(
			prStateDescriptor.restore(prStateDescriptor.serialize(state)),
		).toEqual({
			...state,
			discoveryTestedUrls: ["one"],
		});
	});

	it("records merged PRs and clears the active PR", () => {
		expect(recordMergedPr({ prUrl: PR_42 }, "2026-09-20")).toEqual({
			mergedPrs: [
				{ prUrl: PR_42, detectedAt: "2026-09-20", reminderPending: true },
			],
			discoveryDisabled: false,
		});
	});

	it("keeps reminder and removal state helpers durable", () => {
		const state = {
			mergedPrs: [{ prUrl: PR_42, detectedAt: "date", reminderPending: true }],
		};
		expect(markRemindersDelivered(state)).toEqual({
			mergedPrs: [{ prUrl: PR_42, detectedAt: "date", reminderPending: false }],
		});
		expect(removeMergedPr(state, PR_42)).toEqual({ mergedPrs: [] });
	});

	it("accepts discovery after a session transition", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "old";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.gitState.worktreeRoot = "/repo";
		registerModuleStateConsumer(events, sessionState);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "gh") await blocked;
			return result(JSON.stringify({ url: PR_42 }));
		});
		const module = createPrModule({
			eventHandler: events,
			sessionState,
			exec,
		}) as never as {
			persistPrIfAvailable(text: string): Promise<void>;
		};
		const discovery = module.persistPrIfAvailable(PR_42);
		await Promise.resolve();
		sessionState.session.activeSessionId = "new";
		release();
		await discovery;
		expect(sessionState.moduleState.pr.prUrl).toBe(PR_42);
	});

	it("uses the last returned overlapping discovery result", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.gitState.worktreeRoot = "/repo";
		registerModuleStateConsumer(events, sessionState);
		let releaseFirst!: () => void;
		let releaseSecond!: () => void;
		let calls = 0;
		const first = new Promise<void>((resolve) => (releaseFirst = resolve));
		const second = new Promise<void>((resolve) => (releaseSecond = resolve));
		const exec = vi.fn(async () => {
			calls += 1;
			const url = calls === 1 ? PR_42 : "https://github.com/o/r/pull/43";
			if (calls === 1) await first;
			if (calls === 2) await second;
			return result(JSON.stringify({ url }));
		});
		const module = createPrModule({
			eventHandler: events,
			sessionState,
			exec,
		}) as never as {
			persistPrIfAvailable(text: string): Promise<void>;
		};
		const firstDiscovery = module.persistPrIfAvailable(PR_42);
		const secondDiscovery = module.persistPrIfAvailable(
			"https://github.com/o/r/pull/43",
		);
		await Promise.resolve();
		releaseSecond();
		await secondDiscovery;
		releaseFirst();
		await firstDiscovery;
		expect(sessionState.moduleState.pr.prUrl).toBe(PR_42);
	});

	it("passes current shared state to discovery requests", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const exec = vi.fn(async () => result(JSON.stringify({ url: PR_42 })));
		const module = createPrModule({
			eventHandler: events,
			sessionState,
			exec,
		}) as never as {
			persistPrIfAvailable(text: string): Promise<void>;
		};
		sessionState.moduleState.pr.discoveryTestedUrls = ["already"];
		await module.persistPrIfAvailable(PR_42);
		expect(exec).toHaveBeenCalled();
	});

	it("selects unmerged PRs", () => {
		expect(
			firstUnmergedGithubPrUrl(
				[`${PR_42} https://github.com/o/r/pull/43`],
				[PR_42],
				"git@github.com:o/r.git",
			),
		).toBe("https://github.com/o/r/pull/43");
	});
});
