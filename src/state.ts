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
import type { SessionReader, SessionState } from "./shared/session-state.ts";

export type {
	ExitProtocolModuleState,
	FooterModuleState,
	FooterStatusState,
	GitState,
	HerdrModuleState,
	MergedPrState,
	ModuleId,
	ModuleState,
	PrModuleState,
	SessionMetadata,
	SessionReader,
	SessionRecord,
	SessionState,
	SessionStateSnapshot,
	TodoistModuleState,
	WorktreeModuleState,
} from "./shared/session-state.ts";

import type {
	TaskClaimWorker,
	TodoistClientLike,
	TodoistModule,
	TodoistProjectMapping,
} from "./todoist/state.ts";
import type { WorktreeModule } from "./worktree/state.ts";

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
