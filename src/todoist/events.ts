import type { TaskClaimWorkerResult } from "./state.ts";

export interface TaskClaimResultEvent {
	sessionId: string;
	result: TaskClaimWorkerResult;
}
