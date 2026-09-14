import { describe, expect, it, vi } from "vitest";
import { isCurrentMerge } from "../../src/pr/event-consumers.ts";
import {
	createPrModule,
	firstUnmergedGithubPrUrl,
	isPrState,
	markRemindersDelivered,
	mergedUrls,
	prStateDescriptor,
	recordMergedPr,
	removeMergedPr,
} from "../../src/pr/module.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "../../src/shared/constants.ts";
import { createEventHandler } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

type TestPrModule = {
	activateSession(session: unknown): Promise<void>;
	deactivateSession(): void;
	syncSessionState(session: unknown): Promise<void>;
	initializeRemoteOrigin(
		ctx: unknown,
		remoteOrigin?: string,
	): Promise<string | undefined>;
	persistPrIfAvailable(text: string): Promise<void>;
	persistInitialPr(branch: readonly unknown[]): Promise<void>;
	appendBeforeAgentPrompt(ctx: unknown, messages: string[]): Promise<void>;
};

const createTestPrModule = (
	options: Parameters<typeof createPrModule>[0],
): TestPrModule => createPrModule(options) as unknown as TestPrModule;

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
				discoveryTestedUrls: [],
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

describe("PR state descriptor", () => {
	it("round-trips valid PR state and normalizes tested URLs", () => {
		const state = {
			prUrl: "https://github.com/o/r/pull/42",
			discoveryDisabled: true,
			discoveryTestedUrls: ["one", "one", "two"],
			mergedPrs: [],
		};
		const restored = prStateDescriptor.restore(
			prStateDescriptor.serialize(state),
		);
		expect(restored).toEqual({
			...state,
			discoveryTestedUrls: ["one", "two"],
		});
	});

	it("serializes non-empty PR URLs and deduplicates tested URLs", () => {
		const serialized = prStateDescriptor.serialize({
			prUrl: "",
			discoveryDisabled: true,
			discoveryTestedUrls: ["", "one", "one", "two", "  "],
			mergedPrs: [],
		});
		expect(serialized).toEqual({
			discoveryDisabled: true,
			discoveryTestedUrls: ["one", "two"],
			mergedPrs: [],
		});
	});

	it("restores non-empty PR URLs and deduplicates tested URLs", () => {
		expect(
			prStateDescriptor.restore({
				prUrl: "",
				discoveryDisabled: true,
				discoveryTestedUrls: ["", "one", "one", "two", "  "],
				mergedPrs: [],
			}),
		).toEqual({
			discoveryDisabled: true,
			discoveryTestedUrls: ["one", "two"],
			mergedPrs: [],
		});
	});

	it("falls back to defaults when required PR fields are malformed", () => {
		expect(
			prStateDescriptor.restore({
				prUrl: 42,
				discoveryDisabled: true,
				discoveryTestedUrls: [],
				mergedPrs: [],
			}),
		).toEqual(prStateDescriptor.createInitialState());
		expect(
			prStateDescriptor.restore({
				prUrl: "https://github.com/o/r/pull/42",
				discoveryDisabled: true,
				discoveryTestedUrls: "not-an-array",
				mergedPrs: [],
			}),
		).toEqual(prStateDescriptor.createInitialState());
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
		createTestPrModule({
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

	it("discovers PRs from shared message-end events", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const exec = vi.fn(async () => ({
			stdout: JSON.stringify({ url: "https://github.com/o/r/pull/42" }),
			stderr: "",
			code: 0,
		}));
		createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;

		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		await events.messageEndEvent.emit({
			event: { message: "https://github.com/o/r/pull/42" } as never,
		});

		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					moduleId: "pr",
					moduleState: expect.objectContaining({
						prUrl: "https://github.com/o/r/pull/42",
					}),
				}),
			]),
		);
	});

	it("discovers initial PR from shared initial-discovery events", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const exec = vi.fn(async () => ({
			stdout: JSON.stringify({ url: "https://github.com/o/r/pull/42" }),
			stderr: "",
			code: 0,
		}));
		createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;

		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		await events.initialPrDiscoveryEvent.emit({
			branch: [{ type: "message", text: "https://github.com/o/r/pull/42" }],
			lifecycleEpoch: 0,
		});

		expect(updates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					moduleId: "pr",
					moduleState: expect.objectContaining({
						prUrl: "https://github.com/o/r/pull/42",
					}),
				}),
			]),
		);
	});

	it("skips initial PR discovery when module state disables discovery", async () => {
		const events = createEventHandler();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.moduleState.pr.discoveryDisabled = true;
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;

		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		updates.length = 0;
		await events.initialPrDiscoveryEvent.emit({
			branch: [{ type: "message", text: "https://github.com/o/r/pull/42" }],
			lifecycleEpoch: 0,
		});

		expect(updates).toEqual([]);
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
		sessionState.session.activeSessionId = "session";
		const module = createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});

		await module.initializeRemoteOrigin({
			cwd: "/repo",
			hasUI: false,
		} as never);

		expect(updates).toEqual([
			expect.objectContaining({
				moduleId: "pr",
				gitStatePatch: { remoteOrigin: "git@github.com:o/r.git" },
			}),
		]);
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "session";
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
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 2,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.pr = {
			prUrl: "https://github.com/o/r/pull/42",
			discoveryDisabled: true,
			discoveryTestedUrls: [],
			mergedPrs: [],
		};
		sessionState.moduleState.todoist.taskRef = "task";
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const module = createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		await module.activateSession(session);
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleId: "pr",
				moduleState: expect.objectContaining({
					prUrl: "https://github.com/o/r/pull/42",
					discoveryDisabled: true,
					discoveryTestedUrls: [],
				}),
			}),
		);

		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/43";
		sessionState.moduleState.pr.discoveryDisabled = false;
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
			isCurrentMerge(
				sessionState,
				sessionState.moduleState.pr,
				session,
				2,
				0,
				0,
				"task",
				"https://github.com/o/r/pull/42",
			),
		).toBe(false);
		expect(
			isCurrentMerge(
				sessionState,
				sessionState.moduleState.pr,
				session,
				2,
				0,
				0,
				"task",
				"https://github.com/o/r/pull/43",
			),
		).toBe(true);
		expect(
			isCurrentMerge(
				sessionState,
				sessionState.moduleState.pr,
				session,
				2,
				1,
				0,
				"task",
				"https://github.com/o/r/pull/43",
			),
		).toBe(false);

		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		sessionState.moduleState.pr.discoveryTestedUrls = [
			"https://github.com/o/r/pull/41",
		];
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
					discoveryTestedUrls: ["https://github.com/o/r/pull/41"],
					discoveryDisabled: false,
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
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "old";
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
		const module = createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.initializeRemoteOrigin({
			cwd: "/repo",
			hasUI: false,
		} as never);
		sessionState.session.activeSessionId = "new";
		module.deactivateSession();
		release();
		await discovery;

		expect(sessionState.gitState.remoteOrigin).toBeUndefined();
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
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "old";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
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
		const module = createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.persistPrIfAvailable(
			"https://github.com/o/r/pull/42",
		);
		sessionState.session.activeSessionId = "new";
		module.deactivateSession();
		release();
		await discovery;

		expect(sessionState.moduleState.pr.discoveryTestedUrls).toEqual([]);
		expect(sessionState.moduleState.pr.prUrl).toBeUndefined();
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
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "session";
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "remote") await gate;
			return { stdout: "git@github.com:o/r.git\n", stderr: "", code: 0 };
		});
		const module = createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.activateSession(session);
		const discovery = module.persistPrIfAvailable(
			"https://github.com/o/r/pull/42",
		);
		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/99";
		sessionState.moduleState.pr.discoveryDisabled = true;
		session.workRevision += 1;
		await module.syncSessionState(session);
		release();
		await discovery;

		expect(sessionState.moduleState.pr.prUrl).toBe(
			"https://github.com/o/r/pull/99",
		);
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
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: true,
			hasUncommittedChanges: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		sessionState.session.activeSessionId = "session";
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
				return {
					stdout:
						"worktree /main\nHEAD main\nbranch refs/heads/main\n\nworktree /repo\nHEAD abc\nbranch refs/heads/feature\n",
					stderr: "",
					code: 0,
				};
			return {
				stdout: JSON.stringify([
					{ state: "CLOSED", url: "https://github.com/o/r/pull/42" },
				]),
				stderr: "",
				code: 0,
			};
		});
		createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		const messages: string[] = [];
		await events.beforeAgentStartEvent.emit({
			event: { prompt: "prompt" } as never,
			context: session.context,
			session,
			lifecycleEpoch: 0,
			messages,
		});

		expect(updates).toContainEqual(
			expect.objectContaining({
				gitStatePatch: { remoteOrigin: "git@github.com:o/r.git" },
			}),
		);
		expect(messages).toEqual([C.message.createPr]);
	});

	it("ignores stale before-agent prompt contributions after session changes", async () => {
		const events = createEventHandler();
		const lifecycleEpoch = { value: 1 };
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "old";
		sessionState.gitState.remoteOrigin = "git@github.com:o/r.git";
		const oldContext = { cwd: "/repo", hasUI: false } as never;
		const oldSession = {
			context: oldContext,
			hasPerformedAnyGitMutations: true,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		const newContext = { cwd: "/new", hasUI: false } as never;
		const newSession = {
			context: newContext,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as import("../../src/pr/internal-state.ts").PrSession;
		let releaseInspection!: () => void;
		const inspectionBlocked = new Promise<void>((resolve) => {
			releaseInspection = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "rev-parse") await inspectionBlocked;
			if (args[0] === "rev-parse")
				return { stdout: "/repo\n", stderr: "", code: 0 };
			if (args[0] === "branch")
				return { stdout: "feature\n", stderr: "", code: 0 };
			if (args[0] === "worktree")
				return { stdout: "worktree /repo\n", stderr: "", code: 0 };
			return { stdout: "[]", stderr: "", code: 0 };
		});
		createTestPrModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			getLifecycleEpoch: () => lifecycleEpoch.value,
			dependencies: { exec },
		});
		await events.sessionActivatedEvent.emit({
			context: oldContext,
			session: oldSession,
			lifecycleEpoch: 1,
		});
		const messages: string[] = [];
		const beforeAgent = events.beforeAgentStartEvent.emit({
			event: { prompt: "prompt" } as never,
			context: oldContext,
			session: oldSession,
			lifecycleEpoch: 1,
			messages,
		});
		await Promise.resolve();
		lifecycleEpoch.value = 2;
		await events.sessionActivatedEvent.emit({
			context: newContext,
			session: newSession,
			lifecycleEpoch: 2,
		});
		releaseInspection();
		await beforeAgent;

		expect(messages).toEqual([]);
	});
});
