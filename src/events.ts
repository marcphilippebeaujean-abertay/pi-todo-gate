import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

export type {
	BeforeAgentStartEvent,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
};

export type BeforeAgentStartResultEvent = BeforeAgentStartEventResult;
export type ExtensionBeforeAgentStartEvent = BeforeAgentStartEvent;
export type ExtensionBeforeAgentStartResultEvent = BeforeAgentStartEventResult;
export type ExtensionMessageEndEvent = MessageEndEvent;
export type ExtensionSessionStartEvent = SessionStartEvent;
export type ExtensionToolResultEvent = ToolResultEvent;

export interface ClaimErrorEvent {
	jobType: "Herdr" | "Todoist";
	error: string;
}
