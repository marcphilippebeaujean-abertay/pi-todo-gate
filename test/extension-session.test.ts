import { describe, expect, it, vi } from "vitest";
import {
	handleSessionShutdown,
	handleSessionStart,
	registerModuleStateConsumer,
} from "../src/event-consumer.ts";
import { RootEventPublisher } from "../src/event-publishers.ts";
import { createExtensionState } from "../src/main.ts";
import { type EventHandler, event } from "../src/shared/events.ts";

function context(cwd: string) {
	return {
		cwd,
		mode: "print",
		hasUI: false,
		ui: { setFooter: vi.fn(), theme: { fg: vi.fn() } },
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "session",
		},
	} as never;
}

function rootWithConfig(
	loadConfig: () => Promise<{ projects: Record<string, string> }>,
) {
	const pi = {
		appendEntry: vi.fn(),
		on: vi.fn(),
		registerTool: vi.fn(),
	} as never;
	const state = createExtensionState(pi, {
		loadConfig,
		exec: async () => ({ stdout: "", stderr: "", code: 1 }),
	});
	return (
		state as typeof state & { root: Parameters<typeof handleSessionStart>[0] }
	).root;
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
		registerModuleStateConsumer(
			root.eventHandler,
			root.sessionState,
			() => root.getSession() !== null,
		);
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
