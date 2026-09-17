import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FooterModule } from "../footer/module.ts";
import type { PrModule } from "../pr/module.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { SessionState } from "../state.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistModule,
} from "../todoist/module.ts";
import type { WorktreeCleanup } from "../worktree/module.ts";
import type { PromptQueue } from "./queue.ts";

export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;

export interface CommandDependencies {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule;
	queue: PromptQueue;
	getContext: () => ExtensionContext | null;
	isCurrent: (context: ExtensionContext) => boolean;
}

export interface PromptQueueModuleOptions {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: WorktreeCleanup;
	footer: FooterModule;
	queue?: PromptQueue;
}

export interface PromptQueueModule {
	drain(): Promise<void>;
}

export interface PromptContext {
	context: ExtensionContext;
	sessionId: string;
	isCurrent: () => boolean;
}

export type { ExitActionResult, TodoistCompletionSnapshot };
