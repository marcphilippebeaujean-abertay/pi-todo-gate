import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

export type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
};

export type ExtensionBeforeAgentStartEvent = BeforeAgentStartEvent;
export type ExtensionBeforeAgentStartEventResult = BeforeAgentStartEventResult;
export type ExtensionMessageEndEvent = MessageEndEvent;
export type ExtensionSessionStartEvent = SessionStartEvent;
export type ExtensionToolResultEvent = ToolResultEvent;

export type ClaimJobType = "Herdr" | "Todoist";

export interface ClaimErrorEvent {
	jobType: ClaimJobType;
	error: string;
}
