import type { Event } from "../shared/events.ts";
import { event } from "../shared/events.ts";
import type { ClaimWorkerResponse } from "./internal-state.ts";

export interface ClaimCompletedEvent {
	attemptId: number;
	result?: ClaimWorkerResponse;
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

export function createHerdrEvents(): HerdrEvents {
	return {
		claimCompletedEvent: event<ClaimCompletedEvent>(),
		claimFailedEvent: event<ClaimFailedEvent>(),
	};
}
