import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { FooterModule } from "../src/footer/module.ts";
import type { PrModule } from "../src/pr/module.ts";
import type { PromptQueueModule } from "../src/prompt-queue/module.ts";
import type { TodoistModule } from "../src/todoist/module.ts";
import type { WorktreeModule } from "../src/worktree/module.ts";

type PublicPromptQueue = PromptQueueModule;
const promptQueue: PublicPromptQueue = {} as PublicPromptQueue;
void promptQueue.drain;
const promptQueueOptions = {} as ConstructorParameters<
	typeof PromptQueueModule
>[0];
void promptQueueOptions.pr;
void promptQueueOptions.todoist;
void promptQueueOptions.worktree;

const pr: PrModule = {} as PrModule;
void pr.mergeActivePr;

const cleanup: WorktreeModule = {} as WorktreeModule;
void cleanup.getWorktreeInfo;
void cleanup.hasUncommittedChanges;
void cleanup.removeWorktree;

// @ts-expect-error Lifecycle methods remain internal.
void ({} as PrModule).activateSession;
// @ts-expect-error Lifecycle methods remain internal.
void ({} as TodoistModule).syncSessionState;
// @ts-expect-error Lifecycle methods remain internal.
void ({} as FooterModule).deactivate;
// @ts-expect-error Worktree exposes cleanup capabilities only.
void ({} as WorktreeModule).sessionStart;

describe("module API boundaries", () => {
	it("exposes direct PR merge capability", () => {
		expect(pr).toBeDefined();
	});

	it("exposes Prompt Queue composition with public capabilities", () => {
		expect(promptQueue).toBeDefined();
		expect(promptQueueOptions).toBeDefined();
	});

	it("exposes cleanup capabilities", () => {
		expect(cleanup).toBeDefined();
	});

	it("exports only main module classes", async () => {
		const entrypoints = [
			"pr",
			"todoist",
			"herdr-tab-rename",
			"review",
			"footer",
			"worktree",
			"prompt-queue",
		];
		for (const entrypoint of entrypoints) {
			const source = await readFile(`src/${entrypoint}/module.ts`, "utf8");
			const exportedDeclarations =
				source.match(/^export (?!class ).+$/gm) ?? [];
			expect(exportedDeclarations, entrypoint).toEqual([]);
		}
	});
});
