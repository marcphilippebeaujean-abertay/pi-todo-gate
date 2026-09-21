import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { TAB_CLAIM_INSTRUCTIONS } from "../../src/herdr-tab-rename/constants.ts";
import { installHerdrTabRename } from "../../src/herdr-tab-rename/event-consumers.ts";
import type {
	ClaimWorkerRequest,
	HerdrClient,
	StartBackgroundWorker,
} from "../../src/herdr-tab-rename/internal-state.ts";
import { HerdrTabRenameModule } from "../../src/herdr-tab-rename/module.ts";
import { herdrTabRenameStateDescriptor } from "../../src/herdr-tab-rename/module-state.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

const WORKER_FAILED = "worker failed";

interface FakePi {
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
}

function fakePi(): FakePi {
	return {
		handlers: new Map(),
		on(event, handler) {
			const handlers = this.handlers.get(event) ?? [];
			handlers.push(handler);
			this.handlers.set(event, handlers);
		},
	};
}

function context(
	cwd = "/repo",
	model?: { provider: string; id: string },
): { cwd: string; model?: { provider: string; id: string } } {
	return { cwd, model };
}

function herdrEnvironment(): () => void {
	const previousHerdr = process.env.HERDR_ENV;
	const previousTab = process.env.HERDR_TAB_ID;
	const previousPane = process.env.HERDR_PANE_ID;
	process.env.HERDR_ENV = "1";
	process.env.HERDR_TAB_ID = "w1:t1";
	process.env.HERDR_PANE_ID = "w1:p1";
	return () => {
		if (previousHerdr === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previousHerdr;
		if (previousTab === undefined) delete process.env.HERDR_TAB_ID;
		else process.env.HERDR_TAB_ID = previousTab;
		if (previousPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = previousPane;
	};
}

function ordinaryRunner(label = "probe"): HerdrClient {
	return (command, args) => {
		if (command === "herdr" && args.join(" ") === "tab get w1:t1")
			return JSON.stringify({ result: { tab: { label } } });
		if (command === "herdr" && args.join(" ") === "pane get w1:p1")
			return JSON.stringify({ result: { pane: { tab_id: "w1:t1" } } });
		return "{}";
	};
}

function actionRunner(
	state: { tabId: string; label: string },
	commands: string[],
): HerdrClient {
	return (command, args) => {
		const input = args.join(" ");
		commands.push(`${command} ${input}`);
		if (command !== "herdr") return "{}";
		if (input === "tab get w1:t1" || input === `tab get ${state.tabId}`)
			return JSON.stringify({ result: { tab: { label: state.label } } });
		if (input === "pane get w1:p1")
			return JSON.stringify({ result: { pane: { tab_id: state.tabId } } });
		if (input.startsWith("tab rename ")) {
			state.label = input.split(" ").at(-1) ?? state.label;
			return "{}";
		}
		if (input.includes("pane move")) {
			state.tabId = "w1:t2";
			state.label =
				input.split("--label ").at(-1)?.split(" ")[0] ?? state.label;
			return "{}";
		}
		return "{}";
	};
}

function worker() {
	const requests: ClaimWorkerRequest[] = [];
	const handles: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
	const start: StartBackgroundWorker = vi.fn((request) => {
		requests.push(request);
		const handle = { cancel: vi.fn() };
		handles.push(handle);
		return handle;
	});
	return { start, requests, handles };
}

function setup(herdrClient: HerdrClient = ordinaryRunner()): ReturnType<
	typeof worker
> & {
	pi: FakePi;
	events: ReturnType<typeof createSharedEvents>;
	sessionState: ReturnType<typeof createSessionState>;
	notifications: string[];
	loading: boolean[];
} {
	const pi = fakePi();
	const events = createSharedEvents();
	const sessionState = createSessionState();
	registerModuleStateConsumer(events, sessionState);
	const backgroundWorker = worker();
	const notifications: string[] = [];
	const loading: boolean[] = [];
	events.sessionNotificationEvent.subscribe(({ message }) => {
		notifications.push(message);
	});
	events.actionLoadingEvent.subscribe(({ isLoading }) => {
		loading.push(isLoading);
	});
	installHerdrTabRename(pi as unknown as ExtensionAPI, {
		eventHandler: events,
		sessionState,
		herdrClient,
		startBackgroundWorker: backgroundWorker.start,
	});
	return {
		...backgroundWorker,
		pi,
		events,
		sessionState,
		notifications,
		loading,
	};
}

async function sessionStart(pi: FakePi, ctx = context()): Promise<void> {
	await pi.handlers.get("session_start")?.[0]?.({}, ctx);
}

async function beforeAgentStart(
	pi: FakePi,
	prompt: string,
	ctx = context(),
): Promise<void> {
	await pi.handlers.get("before_agent_start")?.[0]?.({ prompt }, ctx);
}

async function sessionShutdown(pi: FakePi): Promise<void> {
	await pi.handlers.get("session_shutdown")?.[0]?.({}, context());
}

async function emitClaim(
	request: ClaimWorkerRequest,
	label = "dialog-editor",
	shouldMoveToNewTab = false,
): Promise<void> {
	await request.events.claimCompletedEvent.emit({
		result: { tabName: label, shouldMoveToNewTab },
	});
}

async function emitFailure(
	request: ClaimWorkerRequest,
	message = WORKER_FAILED,
): Promise<void> {
	await request.events.claimFailedEvent.emit({
		message,
		workerFailed: true,
	});
}

describe("Herdr module availability and state", () => {
	it("does not register unavailable Herdr setup", () => {
		const previousHerdr = process.env.HERDR_ENV;
		delete process.env.HERDR_ENV;
		const pi = fakePi();
		const sessionState = createSessionState();
		new HerdrTabRenameModule(pi as unknown as ExtensionAPI, {
			eventHandler: createSharedEvents(),
			sessionState,
		});
		if (previousHerdr === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previousHerdr;

		expect(pi.handlers).toEqual(new Map());
		expect(sessionState.moduleState.herdrTabRename).toEqual({});
	});

	it("restores only serializable Herdr claim state", () => {
		expect(
			herdrTabRenameStateDescriptor.restore({
				herdrClaimReturnedSuccessfully: "true",
			}),
		).toEqual({ herdrClaimReturnedSuccessfully: "true" });
		expect(herdrTabRenameStateDescriptor.serialize({})).toEqual({});
		expect(
			herdrTabRenameStateDescriptor.restore({
				pending: Promise.resolve(),
				seen: new Set<string>(),
			}),
		).toEqual({});
	});

	it("does not dispatch when durable success marker is restored", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			state.sessionState.moduleState.herdrTabRename = {
				herdrClaimReturnedSuccessfully: "true",
			};
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "already claimed");
			expect(state.start).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

describe("state-driven background Herdr tab claim", () => {
	it("reads current session state before dispatch and preserves worker model input", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			await sessionStart(state.pi);
			await beforeAgentStart(
				state.pi,
				"claim",
				context("/repo/worktree", {
					provider: "anthropic",
					id: "claude-sonnet-4-5",
				}),
			);
			expect(state.start).toHaveBeenCalledOnce();
			expect(state.requests[0]?.model).toBe("anthropic/claude-sonnet-4-5");
			expect(state.requests[0]?.instructions).toBe(TAB_CLAIM_INSTRUCTIONS);
		} finally {
			restore();
		}
	});

	it("publishes loading and notification separately from durable state", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "claim");
			await emitFailure(state.requests[0] as ClaimWorkerRequest);

			expect(state.loading).toEqual([true, false]);
			expect(state.notifications).toHaveLength(1);
			expect(state.sessionState.moduleState.herdrTabRename).toEqual({});
		} finally {
			restore();
		}
	});

	it("accepts result after session transition and publishes current shared state", async () => {
		const restore = herdrEnvironment();
		try {
			const commands: string[] = [];
			const state = setup(
				actionRunner({ tabId: "w1:t1", label: "7" }, commands),
			);
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "first task");
			await sessionStart(state.pi);
			await emitClaim(state.requests[0] as ClaimWorkerRequest);

			expect(commands).toContain("herdr tab rename w1:t1 dialog-editor");
			expect(state.sessionState.moduleState.herdrTabRename).toEqual({
				herdrClaimReturnedSuccessfully: "true",
			});
		} finally {
			restore();
		}
	});

	it("consumes overlapping workers and lets last returned result win", async () => {
		const restore = herdrEnvironment();
		try {
			const commands: string[] = [];
			const state = setup(
				actionRunner({ tabId: "w1:t1", label: "7" }, commands),
			);
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "first task");
			await beforeAgentStart(state.pi, "second task");
			expect(state.start).toHaveBeenCalledTimes(2);

			await emitClaim(state.requests[1] as ClaimWorkerRequest, "second-label");
			await emitClaim(state.requests[0] as ClaimWorkerRequest, "first-label");

			expect(commands).toContain("herdr tab rename w1:t1 second-label");
			expect(commands).toContain("herdr tab rename w1:t1 first-label");
			expect(
				commands.filter((command) => command.includes("tab rename")).at(-1),
			).toBe("herdr tab rename w1:t1 first-label");
		} finally {
			restore();
		}
	});

	it("retries after worker failure because failure is not durable dispatch state", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "first task");
			await emitFailure(state.requests[0] as ClaimWorkerRequest);
			await beforeAgentStart(state.pi, "retry task");
			expect(state.start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});

	it("reports worker start failure and permits a later retry", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			const start = vi.fn<StartBackgroundWorker>(() => {
				if (start.mock.calls.length === 1)
					throw new Error("worker unavailable");
				return state.start(state.requests.at(-1) as ClaimWorkerRequest);
			});
			state.events.sessionNotificationEvent.subscribe(() => undefined);
			const pi = fakePi();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				eventHandler: state.events,
				sessionState: state.sessionState,
				startBackgroundWorker: start,
			});
			await sessionStart(pi);
			await beforeAgentStart(pi, "first task");
			await beforeAgentStart(pi, "retry task");
			expect(start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});

	it("cancels every active worker only on explicit session shutdown", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup();
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "first task");
			await beforeAgentStart(state.pi, "second task");
			await sessionShutdown(state.pi);

			expect(state.handles[0]?.cancel).toHaveBeenCalledOnce();
			expect(state.handles[1]?.cancel).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("does not cancel or reject a worker across session start", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup(actionRunner({ tabId: "w1:t1", label: "7" }, []));
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "first task");
			await sessionStart(state.pi);
			expect(state.handles[0]?.cancel).not.toHaveBeenCalled();
			await emitClaim(state.requests[0] as ClaimWorkerRequest);
			expect(state.notifications).toEqual([]);
		} finally {
			restore();
		}
	});

	it("renames current tab when worker requests no move", async () => {
		const restore = herdrEnvironment();
		try {
			const commands: string[] = [];
			const state = setup(
				actionRunner({ tabId: "w1:t1", label: "7" }, commands),
			);
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "rename tab");
			await emitClaim(state.requests[0] as ClaimWorkerRequest);
			expect(commands).toContain("herdr tab rename w1:t1 dialog-editor");
			expect(commands).not.toContain(
				"herdr pane move w1:p1 --new-tab --label dialog-editor --no-focus",
			);
		} finally {
			restore();
		}
	});

	it("moves pane to a new labeled tab when worker requests a move", async () => {
		const restore = herdrEnvironment();
		try {
			const commands: string[] = [];
			const state = setup(
				actionRunner({ tabId: "w1:t1", label: "7" }, commands),
			);
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "move tab");
			await emitClaim(
				state.requests[0] as ClaimWorkerRequest,
				"dialog-editor",
				true,
			);
			expect(commands).toContain(
				"herdr pane move w1:p1 --new-tab --label dialog-editor --no-focus",
			);
			expect(commands).not.toContain("herdr tab rename w1:t1 dialog-editor");
		} finally {
			restore();
		}
	});

	it("accepts null when current tab already has descriptive label", async () => {
		const restore = herdrEnvironment();
		try {
			const commands: string[] = [];
			const state = setup(
				actionRunner({ tabId: "w1:t1", label: "dialog-editor" }, commands),
			);
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "already named");
			await state.requests[0]?.events.claimCompletedEvent.emit({
				result: null,
			});
			expect(commands.some((command) => command.includes("tab rename"))).toBe(
				false,
			);
			expect(commands.some((command) => command.includes("pane move"))).toBe(
				false,
			);
			expect(state.sessionState.moduleState.herdrTabRename).toEqual({
				herdrClaimReturnedSuccessfully: "true",
			});
		} finally {
			restore();
		}
	});

	it("keeps validation failure out of durable state", async () => {
		const restore = herdrEnvironment();
		try {
			const state = setup(ordinaryRunner("7"));
			await sessionStart(state.pi);
			await beforeAgentStart(state.pi, "invalid response");
			await emitClaim(state.requests[0] as ClaimWorkerRequest, "7");
			expect(state.sessionState.moduleState.herdrTabRename).toEqual({});
			expect(state.notifications).toHaveLength(1);
		} finally {
			restore();
		}
	});

	it("uses typed response template instructions", () => {
		expect(TAB_CLAIM_INSTRUCTIONS).toContain('"tabName"');
		expect(TAB_CLAIM_INSTRUCTIONS).toContain("return null");
		expect(TAB_CLAIM_INSTRUCTIONS).toContain(
			"Do not rename or move any Herdr tab or pane.",
		);
	});
});
