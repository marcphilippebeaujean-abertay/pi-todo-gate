import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { createModuleStatePublisher } from "../../src/event-publishers.ts";
import { TAB_CLAIM_INSTRUCTIONS } from "../../src/herdr-tab-rename/constants.ts";
import { installHerdrTabRename } from "../../src/herdr-tab-rename/event-consumers.ts";
import {
	CLAIM_WORKER_RESPONSE_TEMPLATE,
	type ClaimWorkerRequest,
	type HerdrClient,
	type StartBackgroundWorker,
} from "../../src/herdr-tab-rename/internal-state.ts";
import { createHerdrTabRenameModule } from "../../src/herdr-tab-rename/module.ts";
import { herdrTabRenameStateDescriptor } from "../../src/herdr-tab-rename/module-state.ts";
import { createSharedEvents, withLoading } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";

const WORKER_FAILED = "worker failed";
const BLOCKS_TAB_NAMING_RETRY_FOR_DESCRIPTIVE_TAB =
	"blocks tab naming retry for a descriptive tab after worker failure";

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
	branch: unknown[] = [],
	model?: { provider: string; id: string },
) {
	return {
		cwd,
		model,
		ui: { notify: vi.fn() },
		sessionManager: { getBranch: () => branch },
	};
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

it("does not register unavailable Herdr setup", () => {
	const previousHerdr = process.env.HERDR_ENV;
	delete process.env.HERDR_ENV;
	const pi = fakePi();
	const sessionState = createSessionState();
	createHerdrTabRenameModule(pi as unknown as ExtensionAPI, {
		eventHandler: createSharedEvents(),
		sessionState,
	});
	if (previousHerdr === undefined) delete process.env.HERDR_ENV;
	else process.env.HERDR_ENV = previousHerdr;

	expect(pi.handlers).toEqual(new Map());
	expect(sessionState.moduleState.herdrTabRename).toEqual({});
});

function worktreeRunner(commands: string[] = []): HerdrClient {
	return (command, args) => {
		const input = args.join(" ");
		commands.push([command, input].join(" "));
		if (command === "git" && input === "rev-parse --git-dir")
			return "/repo/.git/worktrees/feature\n";
		if (command === "git" && input === "rev-parse --git-common-dir")
			return "/repo/.git\n";
		if (command === "git" && input === "branch --show-current")
			return "feature/dialog-editor\n";
		if (command === "herdr" && input === "tab get w1:t1")
			return '{"result":{"tab":{"label":"7"}}}';
		return "{}";
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

function mutableRunner(label: { value: string }): HerdrClient {
	return (command, args) => {
		if (command === "herdr" && args.join(" ") === "tab get w1:t1")
			return JSON.stringify({ result: { tab: { label: label.value } } });
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
		if (input === "tab rename w1:t1 dialog-editor") {
			state.label = "dialog-editor";
			return "{}";
		}
		if (
			input === "pane move w1:p1 --new-tab --label dialog-editor --no-focus"
		) {
			state.tabId = "w1:t2";
			state.label = "dialog-editor";
			return "{}";
		}
		return "{}";
	};
}

function worker() {
	const requests: ClaimWorkerRequest[] = [];
	const start: StartBackgroundWorker = vi.fn((request) => {
		requests.push(request);
		return { cancel: vi.fn() };
	});
	return { start, requests };
}

function emitClaim(
	request: ClaimWorkerRequest,
	label = "dialog-editor",
	shouldMoveToNewTab = false,
): void {
	void request.events.claimCompletedEvent.emit({
		result: { tabName: label, shouldMoveToNewTab },
	});
}

function emitFailure(
	request: ClaimWorkerRequest,
	message = WORKER_FAILED,
): void {
	void request.events.claimFailedEvent.emit({
		message,
		workerFailed: true,
	});
}

describe("Herdr state ownership", () => {
	it("restores only serializable Herdr claim state", () => {
		expect(
			herdrTabRenameStateDescriptor.restore({
				herdrClaimReturnedSuccessfully: "true",
			}),
		).toEqual({ herdrClaimReturnedSuccessfully: "true" });
		expect(
			herdrTabRenameStateDescriptor.restore({
				claimInProgress: true,
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
});

describe("background Herdr tab claim", () => {
	it("publishes action loading separately from durable claim state", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			const claimStates: boolean[] = [];
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("7"),
				startBackgroundWorker: backgroundWorker.start,
				withLoading: async (operation) => {
					claimStates.push(true);
					try {
						await operation();
					} finally {
						claimStates.push(false);
					}
				},
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "claim" },
				context("/repo", [], {
					provider: "anthropic",
					id: "claude-sonnet-4-5",
				}),
			);
			expect(backgroundWorker.requests[0]?.model).toBe(
				"anthropic/claude-sonnet-4-5",
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(claimStates).toEqual([true, false]);
		} finally {
			restore();
		}
	});

	it("accepts active first-prompt response without lifecycle epoch distinction", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const claimStates: boolean[] = [];
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner({ tabId: "w1:t1", label: "7" }, commands),
				startBackgroundWorker: backgroundWorker.start,
				withLoading: async (operation) => {
					claimStates.push(true);
					try {
						await operation();
					} finally {
						claimStates.push(false);
					}
				},
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first task" },
				context(),
			);
			const request = backgroundWorker.requests[0];
			if (request === undefined) throw new Error("worker request missing");
			await request.events.claimCompletedEvent.emit({
				result: { tabName: "dialog-editor", shouldMoveToNewTab: false },
			});
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "second task" },
				context(),
			);
			await request.events.claimCompletedEvent.emit({
				result: { tabName: "late-result", shouldMoveToNewTab: false },
			});

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
			expect(commands).toContain("herdr tab rename w1:t1 dialog-editor");
			expect(commands).not.toContain("herdr tab rename w1:t1 late-result");
			expect(claimStates).toEqual([true, false]);
		} finally {
			restore();
		}
	});

	it("publishes loading separately from durable success marker", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const events = createSharedEvents();
			const sessionState = createSessionState();
			registerModuleStateConsumer(events, sessionState);
			const publisher = createModuleStatePublisher(events, "herdrTabRename");
			const updates: Array<{
				moduleState: typeof sessionState.moduleState.herdrTabRename;
				persist: boolean;
			}> = [];
			const loading: boolean[] = [];
			events.actionLoadingEvent.subscribe(({ isLoading }) => {
				loading.push(isLoading);
			});
			events.moduleStateChangedEvent.subscribe((update) => {
				if (update.moduleId === "herdrTabRename")
					updates.push({
						moduleState: update.moduleState,
						persist: update.persist,
					});
			});
			const backgroundWorker = worker();
			const state = { tabId: "w1:t1", label: "7" };
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner(state, []),
				startBackgroundWorker: backgroundWorker.start,
				withLoading: (operation) =>
					withLoading(events, "pi-todo-gate-herdr", operation),
				onClaimReturnedSuccessfully: () =>
					publisher.publish(
						{
							...sessionState.moduleState.herdrTabRename,
							herdrClaimReturnedSuccessfully: "true",
						},
						{ persist: true },
					),
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await new Promise((resolve) => setTimeout(resolve, 0));
			updates.length = 0;
			loading.length = 0;
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "claim" },
				context(),
			);
			await backgroundWorker.requests[0]?.events.claimCompletedEvent.emit({
				result: { tabName: "dialog-editor", shouldMoveToNewTab: false },
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(loading).toEqual([true, false]);
			expect(updates).toEqual([
				{
					moduleState: { herdrClaimReturnedSuccessfully: "true" },
					persist: true,
				},
			]);
		} finally {
			restore();
		}
	});

	it("derives worker response instructions from typed response template", () => {
		expect(TAB_CLAIM_INSTRUCTIONS).toContain(
			JSON.stringify(CLAIM_WORKER_RESPONSE_TEMPLATE),
		);
		expect(TAB_CLAIM_INSTRUCTIONS).toContain("return null");
		expect(TAB_CLAIM_INSTRUCTIONS).toContain(
			"Do not rename or move any Herdr tab or pane.",
		);
		expect(TAB_CLAIM_INSTRUCTIONS).toContain(
			"Review requests for the current branch or worktree stay in the current tab when the tab relates to the feature under review.",
		);
	});

	it("leaves worktree tab naming to the launcher", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: worktreeRunner(commands),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);

			expect(commands).not.toContain("git branch --show-current");
			expect(commands).not.toContain(
				"herdr tab rename w1:t1 feature/dialog-editor",
			);
			expect(backgroundWorker.start).toHaveBeenCalledOnce();
			expect(pi.handlers.has("tool_call")).toBe(false);
		} finally {
			restore();
		}
	});

	it("suppresses duplicate result and failure after invalid claim response", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const claimContext = context();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner({ tabId: "w1:t1", label: "7" }, commands),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, claimContext);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				claimContext,
			);
			const request = backgroundWorker.requests[0];
			if (request === undefined) throw new Error("worker request missing");
			await request.events.claimCompletedEvent.emit({
				result: { tabName: "7", shouldMoveToNewTab: false },
			});
			await request.events.claimCompletedEvent.emit({
				result: { tabName: "late-result", shouldMoveToNewTab: false },
			});
			await request.events.claimFailedEvent.emit({
				message: "late failure",
				workerFailed: true,
			});

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
			expect(
				commands.filter((command) => command.includes("tab rename")),
			).toEqual(["herdr tab rename w1:t1 7"]);
			expect(claimContext.ui.notify).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("does not dispatch again after worker failure", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("7"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "retry dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("does not dispatch again after worker start failure", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			const start = vi.fn<StartBackgroundWorker>((request) => {
				if (start.mock.calls.length === 1)
					throw new Error("worker unavailable");
				return backgroundWorker.start(request);
			});
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("7"),
				startBackgroundWorker: start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "retry dialog editor" },
				context(),
			);

			expect(start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it(BLOCKS_TAB_NAMING_RETRY_FOR_DESCRIPTIVE_TAB, async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "retry dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("processes successful tab naming once per session", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("dialog-editor"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			emitClaim(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "another task" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("cancels active worker through session-shutdown subscription", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const cancel = vi.fn();
			const start = vi.fn(() => ({ cancel }));
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("7"),
				startBackgroundWorker: start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "claim" },
				context(),
			);
			await pi.handlers.get("session_shutdown")?.[0]?.(
				{ reason: "new" },
				context(),
			);

			expect(cancel).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("does not restart a successful claim after a new session", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			let claimReturned = false;
			const label = { value: "7" };
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: mutableRunner(label),
				startBackgroundWorker: backgroundWorker.start,
				hasClaimReturnedSuccessfully: () => claimReturned,
				onClaimReturnedSuccessfully: () => {
					claimReturned = true;
				},
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "successful claim" },
				context(),
			);
			label.value = "dialog-editor";
			emitClaim(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("session_shutdown")?.[0]?.(
				{ reason: "new" },
				context(),
			);
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "new session" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("renames current tab when worker requests no move", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const state = { tabId: "w1:t1", label: "7" };
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner(state, commands),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "rename tab" },
				context(),
			);
			emitClaim(backgroundWorker.requests[0] as ClaimWorkerRequest);

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
			const pi = fakePi();
			const commands: string[] = [];
			const state = { tabId: "w1:t1", label: "7" };
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner(state, commands),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "move tab" },
				context(),
			);
			emitClaim(
				backgroundWorker.requests[0] as ClaimWorkerRequest,
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

	it("does nothing when worker reports no tab changes are needed", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: actionRunner(
					{ tabId: "w1:t1", label: "dialog-editor" },
					commands,
				),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "already named" },
				context(),
			);
			void backgroundWorker.requests[0]?.events.claimCompletedEvent.emit({
				result: null,
			});

			expect(commands.some((command) => command.includes("tab rename"))).toBe(
				false,
			);
			expect(commands.some((command) => command.includes("pane move"))).toBe(
				false,
			);
		} finally {
			restore();
		}
	});

	it("does not restart after a successful unchanged-label response", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("dialog-editor"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "already named" },
				context(),
			);
			void backgroundWorker.requests[0]?.events.claimCompletedEvent.emit({
				result: null,
			});
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "another task" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("keeps gate processed across session start until shutdown", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first task" },
				context(),
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "second task" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("allows tab naming again after session shutdown", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first task" },
				context(),
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("session_shutdown")?.[0]?.({}, context());
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "second task" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});

	it("starts tab naming in background without blocking tools", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
			expect(backgroundWorker.requests[0]?.instructions).toContain(
				"herdr pane current",
			);
			expect(pi.handlers.has("tool_call")).toBe(false);
			expect(pi.handlers.has("tool_result")).toBe(false);
		} finally {
			restore();
		}
	});

	it("resets worker flags after session shutdown", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabRename(pi as unknown as ExtensionAPI, {
				herdrClient: ordinaryRunner("7"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first session" },
				context(),
			);
			emitFailure(backgroundWorker.requests[0] as ClaimWorkerRequest);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "ignored task" },
				context(),
			);
			expect(backgroundWorker.start).toHaveBeenCalledOnce();

			await pi.handlers.get("session_shutdown")?.[0]?.({}, context());
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "later session" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});
});
