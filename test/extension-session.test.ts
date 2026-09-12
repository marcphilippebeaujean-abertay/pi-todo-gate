import { describe, expect, it, vi } from "vitest";
import {
	handleSessionShutdown,
	handleSessionStart,
	registerModuleStateConsumer,
} from "../src/event-consumer.ts";
import { RootEventPublisher } from "../src/event-publishers.ts";
import { createExtensionState } from "../src/main.ts";
import { type EventHandler, event } from "../src/shared/events.ts";

function context(cwd: string, branch: unknown[] = []) {
	return {
		cwd,
		mode: "print",
		hasUI: false,
		ui: { setFooter: vi.fn(), theme: { fg: vi.fn() } },
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session",
		},
	} as never;
}

function rootWithConfig(
	loadConfig: () => Promise<{ projects: Record<string, string> }>,
	exec: (
		command: string,
		args: string[],
	) => Promise<{
		stdout: string;
		stderr: string;
		code: number;
	}> = async () => ({ stdout: "", stderr: "", code: 1 }),
	openSession?: (path: string) => {
		getCwd: () => string;
		getSessionId: () => string;
		getBranch: () => unknown[];
	},
) {
	const pi = {
		appendEntry: vi.fn(),
		on: vi.fn(),
		registerTool: vi.fn(),
	} as never;
	const state = createExtensionState(pi, { loadConfig, exec, openSession });
	const root = (
		state as typeof state & { root: Parameters<typeof handleSessionStart>[0] }
	).root;
	registerModuleStateConsumer(
		root.eventHandler,
		root.sessionState,
		() => root.getSession() !== null,
	);
	return root;
}

describe("session shutdown", () => {
	it("clears shared state and deactivates modules", () => {
		const eventHandler = {
			moduleStateChangedEvent: event(),
			sessionStateChangedEvent: event(),
			toolResultEvent: event(),
			sessionResetEvent: event(),
			sessionActivatedEvent: event(),
			sessionDeactivatedEvent: event(),
			prMergedEvent: event(),
			footerUpdateEvent: event(),
		} as unknown as EventHandler;
		const footer = { deactivate: vi.fn() };
		const exitProtocol = { deactivate: vi.fn() };
		eventHandler.sessionDeactivatedEvent.subscribe(() => footer.deactivate());
		eventHandler.sessionDeactivatedEvent.subscribe(() =>
			exitProtocol.deactivate(),
		);
		const runtime = {
			eventHandler,
			publisher: new RootEventPublisher(eventHandler),
			lifecycleEpoch: { value: 0 },
			promptQueue: { reset: vi.fn() },
			sessionState: {
				sessionId: "session",
				gitState: { branch: "main" },
				moduleState: { work: {} },
			},
			getSession: () => null,
			setSession: vi.fn(),
			pr: { deactivateSession: vi.fn() },
			footer,
			worktree: { deactivate: vi.fn() },
			exitProtocol,
		} as unknown as Parameters<typeof handleSessionShutdown>[0];

		handleSessionShutdown(runtime);

		expect(runtime.promptQueue.reset).toHaveBeenCalledOnce();
		expect(runtime.sessionState).toMatchObject({
			sessionId: null,
			gitState: {},
			moduleState: {},
		});
		expect(runtime.footer.deactivate).toHaveBeenCalledOnce();
		expect(runtime.worktree.deactivate).toHaveBeenCalledOnce();
		expect(runtime.exitProtocol.deactivate).toHaveBeenCalledOnce();
	});

	it("retains startup module snapshots after activation", async () => {
		const updates: Array<{ moduleId: string }> = [];
		const root = rootWithConfig(
			async () => ({ projects: { "/repo": "project" } }),
			async (command, args) => {
				const key = [command, ...args].join(" ");
				if (key === "git rev-parse --show-toplevel")
					return { stdout: "/repo\n", stderr: "", code: 0 };
				if (key === "git branch --show-current")
					return { stdout: "feature\n", stderr: "", code: 0 };
				if (key === "git worktree list --porcelain")
					return {
						stdout:
							"worktree /main\nHEAD main\nbranch refs/heads/main\n\nworktree /repo\nHEAD abc\nbranch refs/heads/feature\n",
						stderr: "",
						code: 0,
					};
				if (key === "git rev-parse HEAD")
					return { stdout: "abc\n", stderr: "", code: 0 };
				return { stdout: "", stderr: "", code: 0 };
			},
		);
		root.eventHandler.moduleStateChangedEvent.subscribe(({ moduleId }) => {
			updates.push({ moduleId });
		});
		await handleSessionStart(
			root,
			{ type: "session_start" } as never,
			context("/repo", [
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { remoteOrigin: "https://persisted.example/repo.git" },
				},
			]),
		);
		expect(updates.map(({ moduleId }) => moduleId)).toEqual(
			expect.arrayContaining(["worktree", "pr", "exit-protocol"]),
		);
		expect(root.sessionState.gitState).toMatchObject({
			isWorktree: true,
			branch: "feature",
			remoteOrigin: "https://persisted.example/repo.git",
		});
	});

	it("projects inherited handoff origin before persistence", async () => {
		const root = rootWithConfig(
			async () => ({ projects: { "/repo": "project" } }),
			async (command, args) => {
				const key = [command, ...args].join(" ");
				if (key === "git rev-parse --show-toplevel")
					return { stdout: "/repo\n", stderr: "", code: 0 };
				if (key === "git branch --show-current")
					return { stdout: "feature\n", stderr: "", code: 0 };
				if (key === "git worktree list --porcelain")
					return {
						stdout:
							"worktree /main\nHEAD main\nbranch refs/heads/main\n\nworktree /repo\nHEAD abc\nbranch refs/heads/feature\n",
						stderr: "",
						code: 0,
					};
				return { stdout: "", stderr: "", code: 0 };
			},
			() => ({
				getCwd: () => "/repo",
				getSessionId: () => "previous-session",
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-todo-gate-state",
						data: {
							remoteOrigin: "https://persisted.example/repo.git",
						},
					},
				],
			}),
		);
		await handleSessionStart(
			root,
			{
				type: "session_start",
				previousSessionFile: "previous",
			} as never,
			context("/repo"),
		);
		expect(root.sessionState.gitState.remoteOrigin).toBe(
			"https://persisted.example/repo.git",
		);
		expect(root.pi.appendEntry).toHaveBeenCalledWith(
			"pi-todo-gate-state",
			expect.objectContaining({
				remoteOrigin: "https://persisted.example/repo.git",
				inheritedFrom: "previous-session",
			}),
		);
	});

	it("does not append origin after concurrent shutdown", async () => {
		let originStarted = false;
		let releaseOrigin!: () => void;
		const originBlocked = new Promise<void>((resolve) => {
			releaseOrigin = resolve;
		});
		const root = rootWithConfig(
			async () => ({ projects: { "/repo": "project" } }),
			async (command, args) => {
				const key = [command, ...args].join(" ");
				if (key === "git remote get-url origin") {
					originStarted = true;
					await originBlocked;
					return {
						stdout: "https://github.com/o/r.git\n",
						stderr: "",
						code: 0,
					};
				}
				if (key === "git rev-parse --show-toplevel")
					return { stdout: "/repo\n", stderr: "", code: 0 };
				if (key === "git branch --show-current")
					return { stdout: "feature\n", stderr: "", code: 0 };
				if (key === "git worktree list --porcelain")
					return {
						stdout: "worktree /repo\nHEAD abc\nbranch refs/heads/feature\n",
						stderr: "",
						code: 0,
					};
				return { stdout: "", stderr: "", code: 0 };
			},
		);
		const start = handleSessionStart(
			root,
			{ type: "session_start" } as never,
			context("/repo"),
		);
		for (let attempt = 0; attempt < 20 && !originStarted; attempt += 1)
			await Promise.resolve();
		expect(originStarted).toBe(true);
		handleSessionShutdown(root);
		releaseOrigin();
		await start;
		const appendEntry = (
			root.pi as never as { appendEntry: ReturnType<typeof vi.fn> }
		).appendEntry;
		expect(appendEntry).not.toHaveBeenCalled();
		expect(root.sessionState).toMatchObject({
			sessionId: null,
			gitState: {},
			moduleState: {},
		});
	});

	it("does not activate stale concurrent starts", async () => {
		let releaseFirst!: (config: { projects: Record<string, string> }) => void;
		let calls = 0;
		const root = rootWithConfig(() => {
			calls += 1;
			if (calls === 1)
				return new Promise((resolve) => {
					releaseFirst = resolve;
				});
			return Promise.resolve({ projects: {} });
		});
		const first = handleSessionStart(
			root,
			{ type: "session_start" } as never,
			context("/repo"),
		);
		await Promise.resolve();
		const second = handleSessionStart(
			root,
			{ type: "session_start" } as never,
			context("/repo"),
		);
		releaseFirst({ projects: { "/repo": "project" } });
		await Promise.all([first, second]);
		expect(root.getSession()).toBeNull();
		expect(root.sessionState).toMatchObject({
			sessionId: null,
			gitState: {},
			moduleState: {},
		});
	});

	it("keeps reset state clear after shutdown races", async () => {
		let release!: (config: { projects: Record<string, string> }) => void;
		const root = rootWithConfig(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const stateReference = root.sessionState;
		const start = handleSessionStart(
			root,
			{ type: "session_start" } as never,
			context("/repo"),
		);
		await Promise.resolve();
		handleSessionShutdown(root);
		void root.eventHandler.moduleStateChangedEvent.emit({
			moduleId: "stale",
			moduleState: { value: true },
		});
		release({ projects: { "/repo": "project" } });
		await start;
		await root.eventHandler.moduleStateChangedEvent.emit({
			moduleId: "late",
			moduleState: { value: true },
		});
		await Promise.resolve();
		expect(root.getSession()).toBeNull();
		expect(root.sessionState).toBe(stateReference);
		expect(root.sessionState).toMatchObject({
			sessionId: null,
			gitState: {},
			moduleState: {},
		});
	});
});
