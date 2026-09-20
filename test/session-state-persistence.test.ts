import { describe, expect, it } from "vitest";
import { FOOTER_TASK_TYPE } from "../src/footer/constants.ts";
import {
	latestPersistedSessionState,
	type ModuleStateDescriptor,
	restoreSessionState,
	serializeSessionState,
} from "../src/session-state-persistence.ts";
import {
	createSessionState,
	type ModuleId,
	type ModuleState,
	type SessionState,
} from "../src/state.ts";

const STATE_ENTRY_TYPE = "custom";
const STATE_CUSTOM_TYPE = "pi-todo-gate-state";

function descriptors(): {
	[K in ModuleId]: ModuleStateDescriptor<K>;
} {
	const initial = createSessionState().moduleState;
	return {
		pr: {
			id: "pr",
			createInitialState: () => structuredClone(initial.pr),
			restore: (value) => {
				const state = value as ModuleState["pr"];
				return {
					...state,
					discoveryTestedUrls: [
						...new Set(
							state.discoveryTestedUrls.filter(
								(url): url is string =>
									typeof url === "string" && url.length > 0,
							),
						),
					],
				};
			},
			serialize: (state) => structuredClone(state) as never,
		},
		todoist: {
			id: "todoist",
			createInitialState: () => structuredClone(initial.todoist),
			restore: (value) => {
				if (value === null) throw new Error("invalid Todoist state");
				return value as ModuleState["todoist"];
			},
			serialize: (state) => structuredClone(state) as never,
		},
		review: {
			id: "review",
			createInitialState: () => structuredClone(initial.review),
			restore: (value) => value as ModuleState["review"],
			serialize: (state) => structuredClone(state) as never,
		},
		herdrTabRename: {
			id: "herdrTabRename",
			createInitialState: () => structuredClone(initial.herdrTabRename),
			restore: (value) => value as ModuleState["herdrTabRename"],
			serialize: (state) => structuredClone(state) as never,
		},
		worktree: {
			id: "worktree",
			createInitialState: () => structuredClone(initial.worktree),
			restore: (value) => value as ModuleState["worktree"],
			serialize: (state) => structuredClone(state) as never,
		},
		footer: {
			id: "footer",
			createInitialState: () => structuredClone(initial.footer),
			restore: (value) => value as ModuleState["footer"],
			serialize: (state) => structuredClone(state) as never,
		},
	};
}

function snapshot(): SessionState {
	const state = createSessionState();
	state.session.activeSessionId = "active";
	state.session.inheritedFromSessionId = "previous";
	state.gitState = {
		remoteOrigin: "https://github.com/o/r.git",
		mergeCompletedAt: "2026-09-13T12:00:00.000Z",
		branch: "feature",
		isWorktree: true,
		worktreeRoot: "/repo",
		mainRoot: "/main",
		hasUncommittedChanges: true,
	};
	state.moduleState.pr = {
		prUrl: "https://github.com/o/r/pull/42",
		discoveryDisabled: true,
		discoveryTestedUrls: ["https://github.com/o/r/pull/42"],
		mergedPrs: [
			{
				prUrl: "https://github.com/o/r/pull/41",
				detectedAt: "2026-09-13T11:00:00.000Z",
				reminderPending: true,
			},
		],
	};
	state.moduleState.todoist = {
		todoistProjectRef: "Pi Extensions",
		taskRef: "42",
		taskName: "Task",
		taskUrl: "https://todoist.com/app/task/42",
		todoistCompletionAttemptedAt: "2026-09-13T12:01:00.000Z",
		mergePromptedPrUrl: "https://github.com/o/r/pull/42",
	};
	state.moduleState.herdrTabRename.herdrClaimReturnedSuccessfully = "true";
	state.moduleState.footer.footers[FOOTER_TASK_TYPE.id] = {
		footerType: FOOTER_TASK_TYPE,
		isLoading: false,
		currentValue: "ready",
		isVisible: true,
	};
	return state;
}

describe("session state persistence", () => {
	it("serializes complete namespaced state without active session identity", () => {
		const serialized = serializeSessionState(snapshot(), descriptors());

		expect(serialized).toEqual({
			schemaVersion: 1,
			session: { inheritedFromSessionId: "previous" },
			gitState: expect.any(Object),
			moduleState: expect.objectContaining({ pr: expect.any(Object) }),
		});
		expect(serialized).not.toHaveProperty("session.activeSessionId");
		expect(serialized.moduleState.pr.prUrl).toBe(
			"https://github.com/o/r/pull/42",
		);
	});

	it("round-trips persisted state and assigns null active identity", () => {
		const original = snapshot();
		const restored = restoreSessionState(
			serializeSessionState(original, descriptors()),
			descriptors(),
		);

		expect(restored).toEqual({
			...original,
			session: { ...original.session, activeSessionId: null },
		});
	});

	it("migrates legacy herdr state into renamed tab-rename state", () => {
		const source = serializeSessionState(snapshot(), descriptors());
		const legacyHerdr = source.moduleState.herdrTabRename;
		const { herdrTabRename: _renamed, ...otherModules } = source.moduleState;
		const restored = restoreSessionState(
			{
				...source,
				moduleState: {
					...otherModules,
					herdr: legacyHerdr,
				},
			},
			descriptors(),
		);

		expect(restored.moduleState.herdrTabRename).toEqual(legacyHerdr);
	});

	it("falls back to initialized state when root snapshot is malformed", () => {
		const restored = restoreSessionState(
			{ schemaVersion: 1, moduleState: {} },
			descriptors(),
		);

		expect(restored).toEqual(createSessionState());
	});

	it("restores valid slices and defaults only malformed module slices", () => {
		const source = serializeSessionState(snapshot(), descriptors());
		const restored = restoreSessionState(
			{
				...source,
				moduleState: {
					...source.moduleState,
					pr: {
						discoveryDisabled: true,
						discoveryTestedUrls: ["first", "first", "", 42],
						mergedPrs: [],
					},
					todoist: null,
				},
			},
			descriptors(),
		);

		expect(restored.moduleState.pr.discoveryTestedUrls).toEqual(["first"]);
		expect(restored.moduleState.todoist).toEqual(
			createSessionState().moduleState.todoist,
		);
		expect(restored.moduleState.herdrTabRename).toEqual(
			snapshot().moduleState.herdrTabRename,
		);
	});

	it("rejects unsupported schema versions", () => {
		const source = serializeSessionState(snapshot(), descriptors());
		const restored = restoreSessionState(
			{ ...source, schemaVersion: 2 },
			descriptors(),
		);

		expect(restored).toEqual(createSessionState());
	});

	it("finds newest namespaced snapshot and ignores flat or malformed entries", () => {
		const source = serializeSessionState(snapshot(), descriptors());
		const entries = [
			{
				type: STATE_ENTRY_TYPE,
				customType: STATE_CUSTOM_TYPE,
				data: source,
			},
			{
				type: STATE_ENTRY_TYPE,
				customType: STATE_CUSTOM_TYPE,
				data: { prUrl: "old" },
			},
			{ type: "message", data: source },
			{
				type: STATE_ENTRY_TYPE,
				customType: STATE_CUSTOM_TYPE,
				data: { ...source, schemaVersion: 2 },
			},
		];

		expect(latestPersistedSessionState(entries)).toEqual(source);
	});
});
