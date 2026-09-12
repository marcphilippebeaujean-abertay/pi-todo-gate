import type { EventRequest, SharedEventPayloads } from "../shared/events.ts";

export type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;
