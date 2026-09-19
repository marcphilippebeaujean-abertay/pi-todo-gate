import type { FooterModuleState } from "./footer/module-state.ts";
import type { HerdrTabRenameModuleState } from "./herdr-tab-rename/module-state.ts";
import type { PrModuleState } from "./pr/module-state.ts";
import type { ReviewModuleState } from "./review/module-state.ts";
import type {
	SessionReader,
	JsonValue as SharedJsonValue,
	ModuleStateDescriptor as SharedModuleStateDescriptor,
} from "./shared/session-state.ts";
import type { TodoistModuleState } from "./todoist/module-state.ts";
import type { WorktreeModuleState } from "./worktree/module-state.ts";

export type {
	FooterEntryState,
	FooterModuleState,
} from "./footer/module-state.ts";
export type { HerdrTabRenameModuleState } from "./herdr-tab-rename/module-state.ts";
export type { MergedPrState, PrModuleState } from "./pr/module-state.ts";
export type { ReviewModuleState } from "./review/module-state.ts";
export type { SessionReader, SessionRecord } from "./shared/session-state.ts";
export type { TodoistModuleState } from "./todoist/module-state.ts";
export type { WorktreeModuleState } from "./worktree/module-state.ts";

export interface GitState {
	isGitProject?: boolean;
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

export interface ModuleState {
	pr: PrModuleState;
	review: ReviewModuleState;
	todoist: TodoistModuleState;
	herdrTabRename: HerdrTabRenameModuleState;
	worktree: WorktreeModuleState;
	footer: FooterModuleState;
}

export type ModuleId = keyof ModuleState;

export interface SessionState {
	session: SessionMetadata;
	gitState: GitState;
	moduleState: ModuleState;
}

export type SessionStateSnapshot = SessionState;

export type JsonValue = SharedJsonValue;

export type ModuleStateDescriptor<K extends ModuleId> =
	SharedModuleStateDescriptor<K, ModuleState[K]>;

export type ModuleStateDescriptors = {
	[K in ModuleId]: ModuleStateDescriptor<K>;
};

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
			review: {},
			herdrTabRename: {},
			worktree: {},
			footer: { footers: {} },
		},
	};
}

export interface RootDependencies {
	loadConfig?: (path?: string) => Promise<unknown>;
	openSession?: (path: string) => SessionReader;
	exec?: import("./shared/command.ts").Exec;
}

export type { ExtensionDependencies } from "./extension-dependencies.ts";
