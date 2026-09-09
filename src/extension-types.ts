import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExitProtocolModule } from "./exit-protocol/module.ts";
import type { FooterModule } from "./footer/module.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "./herdr/module.ts";
import type { Exec } from "./shared/command.ts";
import type { SharedEvents } from "./shared/events.ts";
import type { TodoistClient } from "./todoist/commands.ts";
import type {
	ResolvedProject,
	TaskClaimWorker,
	TodoistProjectMapping,
} from "./todoist/data.ts";
import type { WorkState } from "./types.ts";
import type { WorktreeModule } from "./worktree/module.ts";

export type WorkStateAction =
	| { action: "status" }
	| { action: "set_pr"; url: string }
	| { action: "clear_pr" }
	| { action: "clear_all" };

export type StateToolParams =
	| { action: "status"; url?: string }
	| { action: "set_pr"; url?: string }
	| { action: "clear_pr"; url?: string }
	| { action: "clear_all"; url?: string };

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
	taskClaimWorker?: TaskClaimWorker;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
}

export type SessionReader = {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
};

export interface ActiveSession {
	sessionId: string;
	context: ExtensionContext;
	project: ResolvedProject;
	state: WorkState;
	allowPrDiscovery: boolean;
	prDiscoveryTestedUrls: Set<string>;
	handoffContext: boolean;
	workChanged: boolean;
	hasUncommittedChanges: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
	taskClaimAnalysisStarted: boolean;
	taskClaimGeneration: number;
}

export interface ExtensionRuntime {
	pi: ExtensionAPI;
	dependencies: ExtensionDependencies;
	events: SharedEvents;
	exitProtocol: ExitProtocolModule;
	footer: FooterModule;
	worktree: WorktreeModule;
	active: ActiveSession | null;
	isCurrentOperation(session: ActiveSession, generation: number): boolean;
	enqueueSessionOperation<T>(
		session: ActiveSession,
		operation: () => Promise<T>,
	): Promise<T>;
	registered: boolean;
}
