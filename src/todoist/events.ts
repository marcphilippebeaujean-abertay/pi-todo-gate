import type { TaskClaimWorkerResult } from "./internal-state.ts";

export interface TaskClaimResultEvent {
	sessionId: string;
	result: TaskClaimWorkerResult;
}
