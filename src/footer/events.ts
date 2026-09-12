import type { FooterUpdateEvent } from "../shared/events.ts";

export type { FooterUpdateEvent } from "../shared/events.ts";

export interface FooterSessionStartEvent {
	previousSessionFile?: string;
}

export type FooterEventSink = (event: FooterUpdateEvent) => void;
