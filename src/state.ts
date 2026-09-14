import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExitProtocolModuleState } from "./exit-protocol/module-state.ts";
import type { FooterModuleState } from "./footer/module-state.ts";
import type { HerdrModuleState } from "./herdr/module-state.ts";
import type { PrModuleState } from "./pr/module-state.ts";
import type {
	SessionReader,
	JsonValue as SharedJsonValue,
	ModuleStateDescriptor as SharedModuleStateDescriptor,
} from "./shared/session-state.ts";
import type { TodoistModuleState } from "./todoist/module-state.ts";
import type { WorktreeModuleState } from "./worktree/module-state.ts";

export type { ExitProtocolModuleState } from "./exit-protocol/module-state.ts";
export type {
	FooterModuleState,
	FooterStatusState,
} from "./footer/module-state.ts";
export type { HerdrModuleState } from "./herdr/module-state.ts";
export type { MergedPrState, PrModuleState } from "./pr/module-state.ts";
export type { SessionReader, SessionRecord } from "./shared/session-state.ts";
export type { TodoistModuleState } from "./todoist/module-state.ts";
export type { WorktreeModuleState } from "./worktree/module-state.ts";

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
			herdr: {},
			worktree: {},
			footer: { footers: {} },
			exitProtocol: { active: false },
		},
	};
}

export interface RootDependencies {
	loadConfig?: (path?: string) => Promise<unknown>;
	openSession?: (path: string) => SessionReader;
}

export type { ExtensionDependencies } from "./extension-dependencies.ts";

export interface ExtensionState {
	pi: ExtensionAPI;
	sessionState: SessionState;
}
