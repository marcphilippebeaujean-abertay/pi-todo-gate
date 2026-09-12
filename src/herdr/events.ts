import type { Event } from "../shared/events.ts";
import { event } from "../shared/events.ts";
import type { ClaimWorkerResult } from "./state.ts";

export interface ClaimCompletedEvent {
	attemptId: number;
	result?: ClaimWorkerResult;
}

export interface ClaimFailedEvent {
	attemptId: number;
	message: string;
	workerFailed: boolean;
}

export interface HerdrEvents {
	claimCompletedEvent: Event<ClaimCompletedEvent>;
	claimFailedEvent: Event<ClaimFailedEvent>;
}

export type FooterEventSink = (event: {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}) => void;

export function createHerdrEvents(): HerdrEvents {
	return {
		claimCompletedEvent: event<ClaimCompletedEvent>(),
		claimFailedEvent: event<ClaimFailedEvent>(),
	};
}
