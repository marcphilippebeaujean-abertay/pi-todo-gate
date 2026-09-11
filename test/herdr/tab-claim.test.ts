import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ClaimWorkerRequest } from "../../src/herdr/claim-worker.ts";
import {
	type CommandRunner,
	installHerdrTabClaim,
	type StartBackgroundWorker,
} from "../../src/herdr/tab-claim.ts";

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

function context(cwd = "/repo", branch: unknown[] = []) {
	return {
		cwd,
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

function worktreeRunner(commands: string[] = []): CommandRunner {
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

function ordinaryRunner(label = "probe"): CommandRunner {
	return (command, args) => {
		if (command === "herdr" && args.join(" ") === "tab get w1:t1")
			return JSON.stringify({ result: { tab: { label } } });
		if (command === "herdr" && args.join(" ") === "pane get w1:p1")
			return JSON.stringify({ result: { pane: { tab_id: "w1:t1" } } });
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

describe("background Herdr tab claim", () => {
	it("leaves worktree tab naming to the launcher", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const commands: string[] = [];
			const backgroundWorker = worker();
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: worktreeRunner(commands),
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

	it("blocks tab naming retry after invalid claim evidence", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner("7"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			backgroundWorker.requests[0]?.onClaimComplete({
				tabId: "w1:t1",
				label: "7",
			});
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "retry dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("retries tab naming after worker failure for a numeric tab", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner("7"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			backgroundWorker.requests[0]?.onFailure(WORKER_FAILED);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "retry dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});

	it("retries after worker start failure for a numeric tab", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			const start = vi.fn<StartBackgroundWorker>((request) => {
				if (start.mock.calls.length === 1)
					throw new Error("worker unavailable");
				return backgroundWorker.start(request);
			});
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner("7"),
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

			expect(start).toHaveBeenCalledTimes(2);
		} finally {
			restore();
		}
	});

	it("ignores persisted claim state in session branch", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const backgroundWorker = worker();
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.(
				{},
				context("/repo", [
					{
						type: "custom",
						customType: "pi-todo-gate-herdr-state",
						data: { ran: true },
					},
				]),
			);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);

			expect(backgroundWorker.start).toHaveBeenCalledOnce();
		} finally {
			restore();
		}
	});

	it("blocks retry after worker start failure for a descriptive tab", async () => {
		const restore = herdrEnvironment();
		try {
			const pi = fakePi();
			const start = vi.fn<StartBackgroundWorker>(() => {
				throw new Error("worker unavailable");
			});
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
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
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			backgroundWorker.requests[0]?.onFailure(WORKER_FAILED);
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
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner("dialog-editor"),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "fix dialog editor" },
				context(),
			);
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "duplicate task" },
				context(),
			);
			backgroundWorker.requests[0]?.onClaimComplete({
				tabId: "w1:t1",
				label: "dialog-editor",
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
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first task" },
				context(),
			);
			backgroundWorker.requests[0]?.onFailure(WORKER_FAILED);
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
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
				startBackgroundWorker: backgroundWorker.start,
			});
			await pi.handlers.get("session_start")?.[0]?.({}, context());
			await pi.handlers.get("before_agent_start")?.[0]?.(
				{ prompt: "first task" },
				context(),
			);
			backgroundWorker.requests[0]?.onFailure(WORKER_FAILED);
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
			installHerdrTabClaim(pi as unknown as ExtensionAPI, {
				commandRunner: ordinaryRunner(),
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
});
