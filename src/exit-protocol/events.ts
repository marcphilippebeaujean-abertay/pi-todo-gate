import type { EventRequest, SharedEventPayloads } from "../shared/events.ts";

export type ExitRequest = EventRequest<
	SharedEventPayloads[keyof SharedEventPayloads]
>;
