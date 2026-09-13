import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExitProtocolModule } from "./exit-protocol/state.ts";
import type { FooterModule } from "./footer/state.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "./herdr/state.ts";
import type { PrModule } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import type { Exec } from "./shared/command.ts";
import type { EventHandler } from "./shared/events.ts";
import type {
	SessionReader,
	SessionRecord,
} from "./shared/session-state.ts";

export type { SessionReader, SessionRecord } from "./shared/session-state.ts";

import type {
	TaskClaimWorker,
	TodoistClientLike,
	TodoistModule,
	TodoistProjectMapping,
} from "./todoist/state.ts";
import type { WorktreeModule } from "./worktree/state.ts";

export interface GitState {
	remoteOrigin?: string;
	mergeCompletedAt?: string;
	branch?: string | null;
	isWorktree?: boolean;
	worktreeRoot?: string | null;
	mainRoot?: string | null;
	hasUncommittedChanges?: boolean;
}

export interface SessionMetadata {
	activeSessionId: string | null;
	inheritedFromSessionId?: string;
}

export interface MergedPrState {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}

export interface PrModuleState {
	prUrl?: string;
	discoveryDisabled?: boolean;
	discoveryTestedUrls?: string[];
	mergedPrs?: MergedPrState[];
}

export interface TodoistModuleState {
	taskRef?: string;
	taskName?: string;
	taskUrl?: string;
	todoistCompletionAttemptedAt?: string;
	mergePromptedPrUrl?: string;
}

export interface HerdrModuleState {
	herdrClaimReturnedSuccessfully?: string;
}

export interface WorktreeModuleState {
	initialHead?: string;
	initialStatus?: string;
}

export interface FooterStatusState {
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterModuleState {
	footers: Record<string, FooterStatusState>;
}

export interface ExitProtocolModuleState {
	active: boolean;
}

export interface ModuleState {
	pr: PrModuleState;
	todoist: TodoistModuleState;
	herdr: HerdrModuleState;
	worktree: WorktreeModuleState;
	footer: FooterModuleState;
	exitProtocol: ExitProtocolModuleState;
}

export type ModuleId = keyof ModuleState;

export interface SessionState {
	session: SessionMetadata;
	gitState: GitState;
	moduleState: ModuleState;
}

export type SessionStateSnapshot = SessionState;

export function createSessionState(): SessionState {
	return {
		session: { activeSessionId: null },
		gitState: {},
		moduleState: {
			pr: {
				discoveryDisabled: false,
				discoveryTestedUrls: [],
				mergedPrs: [],
			},
			todoist: {},
			herdr: {},
			worktree: {},
			footer: { footers: {} },
			exitProtocol: { active: false },
		},
	};
}

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
	taskClaimWorker?: TaskClaimWorker;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
}

export interface ExtensionState {
	pi: ExtensionAPI;
	dependencies: ExtensionDependencies;
	sessionState: SessionState;
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: WorktreeModule;
	exitProtocol: ExitProtocolModule;
}
