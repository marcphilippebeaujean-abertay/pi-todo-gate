import type { EventRequest, SharedEventPayloads } from "../shared/events.ts";
import type { TaskClaimWorkerResult } from "./state.ts";

export interface TaskClaimResultEvent {
	sessionId: string;
	result: TaskClaimWorkerResult;
}

export type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;
