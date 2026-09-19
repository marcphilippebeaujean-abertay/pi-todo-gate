import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { createFooterModule } from "../src/footer/module.ts";
import type { createPrModule } from "../src/pr/module.ts";
import type {
	createPromptQueueModule,
	PromptQueueModuleOptions,
} from "../src/prompt-queue/module.ts";
import type { createTodoistModule } from "../src/todoist/module.ts";
import type {
	createWorktreeModule,
	WorktreeCleanup,
} from "../src/worktree/module.ts";

type PublicPromptQueue = ReturnType<typeof createPromptQueueModule>;
const promptQueue: PublicPromptQueue = {} as PublicPromptQueue;
void promptQueue.drain;
const promptQueueOptions: PromptQueueModuleOptions =
	{} as PromptQueueModuleOptions;
void promptQueueOptions.pr;
void promptQueueOptions.todoist;
void promptQueueOptions.worktree;

type PublicPr = ReturnType<typeof createPrModule>;
const merge: PublicPr = {} as PublicPr;
void merge.mergeActivePr;

type PublicWorktree = ReturnType<typeof createWorktreeModule>;
const cleanup: WorktreeCleanup = {} as PublicWorktree;
void cleanup.getWorktreeInfo;
void cleanup.hasUncommittedChanges;
void cleanup.removeWorktree;

// @ts-expect-error Lifecycle methods remain internal.
void ({} as ReturnType<typeof createPrModule>).activateSession;
// @ts-expect-error Lifecycle methods remain internal.
void ({} as ReturnType<typeof createTodoistModule>).syncSessionState;
// @ts-expect-error Lifecycle methods remain internal.
void ({} as ReturnType<typeof createFooterModule>).deactivate;
// @ts-expect-error Worktree exposes cleanup capabilities only.
void ({} as PublicWorktree).sessionStart;

describe("module API boundaries", () => {
	it("exposes direct PR merge capability", () => {
		expect(merge).toBeDefined();
	});

	it("exposes Prompt Queue composition with public capabilities", () => {
		expect(promptQueue).toBeDefined();
		expect(promptQueueOptions).toBeDefined();
	});

	it("exposes cleanup capability without lifecycle methods", () => {
		expect(cleanup).toBeDefined();
	});

	it("does not wildcard-export implementation facets", async () => {
		const entrypoints = [
			"pr",
			"todoist",
			"herdr-tab-rename",
			"review",
			"footer",
			"worktree",
		];
		const forbidden =
			/export \* from "\.\/(commands|git|parsing|runtime|notifications|user-prompts|claim-worker-result|events|footer-rendering)\.ts"/;
		for (const entrypoint of entrypoints) {
			const source = await readFile(`src/${entrypoint}/module.ts`, "utf8");
			expect(source, entrypoint).not.toMatch(forbidden);
		}
	});
});
