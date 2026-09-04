import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Exec } from "./git.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "./herdr-tab-claim.ts";
import type { TaskClaimWorker } from "./todoist/claim-worker.ts";
import type { TodoistClient } from "./todoist/client.ts";
import type {
	ResolvedProject,
	TodoistProjectMapping,
	WorkState,
} from "./types.ts";

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
	context: ExtensionContext;
	project: ResolvedProject;
	state: WorkState;
	allowPrDiscovery: boolean;
	handoffContext: boolean;
	workChanged: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
	taskClaimAnalysisStarted: boolean;
	taskClaimGeneration: number;
}

export interface ExtensionRuntime {
	pi: ExtensionAPI;
	dependencies: ExtensionDependencies;
	active: ActiveSession | null;
	registered: boolean;
}
