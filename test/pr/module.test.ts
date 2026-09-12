import { describe, expect, it, vi } from "vitest";
import {
	createPrModule,
	firstUnmergedGithubPrUrl,
	isPrState,
	markRemindersDelivered,
	mergedUrls,
	recordMergedPr,
	removeMergedPr,
} from "../../src/pr/module.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createEventHandler } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

describe("isPrState", () => {
	it("accepts valid PR state and rejects malformed state", () => {
		expect(
			isPrState({
				prUrl: "https://github.com/o/r/pull/42",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/41",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
				],
				discoveryDisabled: true,
			}),
		).toBe(true);
		expect(isPrState({ prUrl: 42 })).toBe(false);
		expect(
			isPrState({
				mergedPrs: [{ prUrl: "https://github.com/o/r/pull/41" }],
			}),
		).toBe(false);
	});
});

describe("recordMergedPr", () => {
	it("records each merged PR and clears active PR", () => {
		const next = recordMergedPr(
			{ prUrl: "https://github.com/o/r/pull/42" },
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});

	it("refreshes an existing merged PR record without duplicating its URL", () => {
		const next = recordMergedPr(
			{
				prUrl: "https://github.com/o/r/pull/42",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
					{
						prUrl: "https://github.com/o/r/pull/41",
						detectedAt: "2026-08-28T00:00:00Z",
						reminderPending: false,
					},
				],
			},
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/41",
					detectedAt: "2026-08-28T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});

	it("appends second merged PR without duplicating existing URL records", () => {
		const next = recordMergedPr(
			{
				prUrl: "https://github.com/o/r/pull/43",
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
				],
				discoveryDisabled: true,
			},
			"2026-08-30T00:00:00Z",
		);

		expect(next).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-29T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
			discoveryDisabled: false,
		});
	});
});

describe("markRemindersDelivered", () => {
	it("marks all pending reminders delivered and preserves existing records", () => {
		expect(
			markRemindersDelivered({
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: true,
					},
					{
						prUrl: "https://github.com/o/r/pull/43",
						detectedAt: "2026-08-30T00:00:00Z",
						reminderPending: false,
					},
				],
			}),
		).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/42",
					detectedAt: "2026-08-29T00:00:00Z",
					reminderPending: false,
				},
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: false,
				},
			],
		});
	});
});

describe("removeMergedPr", () => {
	it("removes a merged PR URL so it can be reused explicitly", () => {
		expect(
			removeMergedPr(
				{
					mergedPrs: [
						{
							prUrl: "https://github.com/o/r/pull/42",
							detectedAt: "2026-08-29T00:00:00Z",
							reminderPending: false,
						},
						{
							prUrl: "https://github.com/o/r/pull/43",
							detectedAt: "2026-08-30T00:00:00Z",
							reminderPending: true,
						},
					],
				},
				"https://github.com/o/r/pull/42",
			),
		).toEqual({
			mergedPrs: [
				{
					prUrl: "https://github.com/o/r/pull/43",
					detectedAt: "2026-08-30T00:00:00Z",
					reminderPending: true,
				},
			],
		});
	});
});

describe("mergedUrls", () => {
	it("returns every merged PR URL", () => {
		expect(
			mergedUrls({
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						detectedAt: "2026-08-29T00:00:00Z",
						reminderPending: false,
					},
					{
						prUrl: "https://github.com/o/r/pull/43",
						detectedAt: "2026-08-30T00:00:00Z",
						reminderPending: true,
					},
				],
			}),
		).toEqual([
			"https://github.com/o/r/pull/42",
			"https://github.com/o/r/pull/43",
		]);
	});
});

describe("firstUnmergedGithubPrUrl", () => {
	it("selects next URL while excluding every merged URL", () => {
		expect(
			firstUnmergedGithubPrUrl(
				[
					"https://github.com/owner/repo/pull/42 https://github.com/owner/repo/pull/43",
				],
				["https://github.com/owner/repo/pull/42"],
				"https://github.com/owner/repo.git",
			),
		).toBe("https://github.com/owner/repo/pull/43");
	});

	it("returns null when all discovered URLs were already merged", () => {
		expect(
			firstUnmergedGithubPrUrl(
				[
					"https://github.com/owner/repo/pull/42 https://github.com/owner/repo/pull/43",
				],
				[
					"https://github.com/owner/repo/pull/42",
					"https://github.com/owner/repo/pull/43",
				],
				"https://github.com/owner/repo.git",
			),
		).toBeNull();
	});
});

describe("PR module ownership", () => {
	it("emits remote origin through module state and shared Git state", async () => {
		const events = createEventHandler();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const exec = vi.fn(async (command: string, args: string[]) => {
			if (args[0] === "remote")
				return { stdout: "git@github.com:o/r.git\n", stderr: "", code: 0 };
			return command === "git"
				? { stdout: "/repo\n", stderr: "", code: 0 }
				: { stdout: "", stderr: "", code: 0 };
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
			getSession: () => null,
			dependencies: { exec },
		});

		await module.initializeRemoteOrigin(
			{ cwd: "/repo", hasUI: false } as never,
			{},
		);

		expect(updates).toEqual([
			expect.objectContaining({
				moduleId: "pr",
				gitStatePatch: { remoteOrigin: "git@github.com:o/r.git" },
			}),
		]);
		await events.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/42",
			taskMarkedAsCompleted: false,
		});
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleId: "pr",
				moduleState: expect.objectContaining({
					mergedPrs: expect.arrayContaining([
						expect.objectContaining({
							prUrl: "https://github.com/o/r/pull/42",
						}),
					]),
				}),
			}),
		);
	});

	it("guards merge results by stable session and PR generations", () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		const session = {
			sessionId: "session",
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo" },
			state: { prUrl: "https://github.com/o/r/pull/42", taskRef: "task" },
			allowPrDiscovery: false,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: false,
			hasUncommittedChanges: false,
			workRevision: 2,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			getSession: () => session,
		});
		module.activateSession(session);

		expect(
			module.isCurrentMerge(
				session,
				2,
				0,
				"task",
				"https://github.com/o/r/pull/42",
			),
		).toBe(true);
		expect(
			module.isCurrentMerge(
				session,
				2,
				1,
				"task",
				"https://github.com/o/r/pull/42",
			),
		).toBe(false);
	});
});
