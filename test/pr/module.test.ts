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
	it("registers PI command and state tool once when registrations become available", async () => {
		const events = createEventHandler();
		const registerCommand = vi.fn();
		const registerTool = vi.fn();
		const pi = {
			on: vi.fn(),
			registerCommand,
			registerTool,
		};
		const extensionApi = pi as never;
		createPrModule({
			pi: extensionApi,
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
		});

		expect(registerCommand).not.toHaveBeenCalled();
		expect(registerTool).not.toHaveBeenCalled();

		await events.piToolRegistrationsBecameAvailableEvent.emit({
			pi: extensionApi,
		});
		await events.piToolRegistrationsBecameAvailableEvent.emit({
			pi: extensionApi,
		});

		expect(registerCommand).toHaveBeenCalledOnce();
		expect(registerTool).toHaveBeenCalledOnce();
	});

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
		const sessionState = createSessionState();
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
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
		const session = {
			sessionId: "session",
			context: { cwd: "/repo", hasUI: false },
			state: {},
			project: { codingRoot: "/repo" },
			allowPrDiscovery: true,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		await module.activateSession(session);
		await events.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/42",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
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

	it("guards merge results by stable session and PR generations", async () => {
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
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		await module.activateSession(session);
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleId: "pr",
				moduleState: expect.objectContaining({
					remoteOrigin: undefined,
					prUrl: "https://github.com/o/r/pull/42",
					discoveryTestedUrls: [],
				}),
			}),
		);

		session.state.prUrl = "https://github.com/o/r/pull/43";
		session.allowPrDiscovery = true;
		await module.syncSessionState(session);
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					prUrl: "https://github.com/o/r/pull/43",
					discoveryDisabled: false,
				}),
			}),
		);

		expect(
			module.isCurrentMerge(
				session,
				2,
				0,
				"task",
				"https://github.com/o/r/pull/42",
			),
		).toBe(false);
		expect(
			module.isCurrentMerge(
				session,
				2,
				0,
				"task",
				"https://github.com/o/r/pull/43",
			),
		).toBe(true);

		session.state.remoteOrigin = "git@github.com:o/r.git";
		session.prDiscoveryTestedUrls.add("https://github.com/o/r/pull/41");
		await module.syncSessionState(session);
		await events.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/43",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					remoteOrigin: "git@github.com:o/r.git",
					discoveryTestedUrls: ["https://github.com/o/r/pull/41"],
					discoveryDisabled: false,
					operationGeneration: 0,
					mergedPrs: expect.any(Array),
				}),
			}),
		);
	});

	it("rejects stale remote-origin discovery", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		const session = {
			sessionId: "old",
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo" },
			state: {},
			allowPrDiscovery: true,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "remote") await gate;
			return { stdout: "git@github.com:o/r.git\n", stderr: "", code: 0 };
		});
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.initializeRemoteOrigin(
			{ cwd: "/repo", hasUI: false } as never,
			session.state,
		);
		sessionState.sessionId = "new";
		module.deactivateSession();
		release();
		await discovery;

		expect(session.state.remoteOrigin).toBeUndefined();
		expect(
			updates.filter((update) =>
				Object.hasOwn(update as object, "gitStatePatch"),
			),
		).toHaveLength(0);
	});

	it("rejects stale PR candidate results before tested-url mutation", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		const session = {
			sessionId: "old",
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "" },
			state: { remoteOrigin: "git@github.com:o/r.git" },
			allowPrDiscovery: true,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "pr") await gate;
			return {
				stdout: JSON.stringify({ url: "https://github.com/o/r/pull/42" }),
				stderr: "",
				code: 0,
			};
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.persistPrIfAvailable(
			"https://github.com/o/r/pull/42",
		);
		sessionState.sessionId = "new";
		module.deactivateSession();
		release();
		await discovery;

		expect(session.prDiscoveryTestedUrls).toEqual(new Set());
		expect(session.state.prUrl).toBeUndefined();
	});

	it("does not let origin discovery overwrite same-session set_pr", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		const session = {
			sessionId: "session",
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo" },
			state: {},
			allowPrDiscovery: true,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "remote") await gate;
			return { stdout: "git@github.com:o/r.git\n", stderr: "", code: 0 };
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.persistPrIfAvailable(
			"https://github.com/o/r/pull/42",
		);
		session.state = { prUrl: "https://github.com/o/r/pull/99" };
		session.allowPrDiscovery = false;
		session.workRevision += 1;
		await module.syncSessionState(session);
		release();
		await discovery;

		expect(session.state).toEqual({
			prUrl: "https://github.com/o/r/pull/99",
		});
	});

	it("persists and emits origin discovered during before-agent prompting", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		const session = {
			sessionId: "session",
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo" },
			state: {},
			allowPrDiscovery: true,
			prDiscoveryTestedUrls: new Set<string>(),
			handoffContext: false,
			workChanged: true,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/state.ts").PrSession;
		sessionState.sessionId = session.sessionId;
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "remote")
				return { stdout: "git@github.com:o/r.git\n", stderr: "", code: 0 };
			if (args[0] === "rev-parse")
				return { stdout: "/repo\n", stderr: "", code: 0 };
			if (args[0] === "branch")
				return { stdout: "feature\n", stderr: "", code: 0 };
			if (args[0] === "worktree")
				return { stdout: "worktree /repo\n", stderr: "", code: 0 };
			return { stdout: "[]", stderr: "", code: 0 };
		});
		const module = createPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const messages: string[] = [];
		await module.appendBeforeAgentPrompt(
			{ cwd: "/repo", hasUI: false } as never,
			messages,
		);

		expect(session.state.remoteOrigin).toBe("git@github.com:o/r.git");
		expect(updates).toContainEqual(
			expect.objectContaining({
				gitStatePatch: { remoteOrigin: "git@github.com:o/r.git" },
			}),
		);
	});
});
