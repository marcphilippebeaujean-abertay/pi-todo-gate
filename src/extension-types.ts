import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Exec } from "./git.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "./herdr-tab-claim.ts";
import type { TodoistClient } from "./todoist.ts";
import type {
	ResolvedProject,
	TodoistProjectMapping,
	WorkState,
} from "./types.ts";

export type WorkStateAction =
	| { action: "status" }
	| { action: "set_pr"; url: string }
	| { action: "clear_pr" }
	| { action: "set_task"; task: string }
	| { action: "clear_task" }
	| { action: "clear_all" };

export type StateToolParams =
	| { action: "status"; url?: string; task?: string }
	| { action: "set_pr"; url?: string; task?: string }
	| { action: "clear_pr"; url?: string; task?: string }
	| { action: "set_task"; url?: string; task?: string }
	| { action: "clear_task"; url?: string; task?: string }
	| { action: "clear_all"; url?: string; task?: string };

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
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
	syncAvailable: boolean;
	workRevision: number;
	syncGeneration: number;
	syncTimer?: ReturnType<typeof setTimeout>;
}

export interface ExtensionRuntime {
	pi: ExtensionAPI;
	dependencies: ExtensionDependencies;
	active: ActiveSession | null;
	registered: boolean;
}
