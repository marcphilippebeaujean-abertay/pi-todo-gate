import type { Exec } from "./shared/command.ts";
import type { SessionReader } from "./shared/session-state.ts";

/** Optional seams used by the extension entrypoint and module tests. */
export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<unknown>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: unknown;
	taskClaimWorker?: unknown;
	herdrCommandRunner?: unknown;
	herdrSpawnWorker?: unknown;
}
