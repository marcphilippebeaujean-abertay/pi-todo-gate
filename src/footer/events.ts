export type {
	FooterLoadingEvent,
	FooterUpdateEvent,
} from "../shared/events.ts";

export interface FooterSessionStartEvent {
	previousSessionFile?: string;
}
