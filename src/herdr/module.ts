import "./commands.ts";
import "./runtime.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./events.ts";
import "./user-prompts.ts";
import "./notifications.ts";

import { createModuleStatePublisher } from "../event-publishers.ts";
import { HERDR_CLAIM_RETURNED } from "./constants.ts";
import type {
	HerdrModuleSetupOptions,
	HerdrTabOptions,
} from "./internal-state.ts";
import { isInsideHerdr } from "./runtime.ts";

export type HerdrModule = Record<never, never>;

export * from "./claim-worker-result.ts";
export * from "./commands.ts";

import { installHerdrTabClaim } from "./event-consumers.ts";

export * from "./events.ts";
export * from "./module-state.ts";
export * from "./runtime.ts";
export * from "./tab-validation.ts";

export function createHerdrModule(
	pi: Parameters<typeof installHerdrTabClaim>[0],
	options: HerdrModuleSetupOptions,
): HerdrModule {
	const isUnavailable = !isInsideHerdr();
	if (isUnavailable) return {};
	const statePublisher = createModuleStatePublisher(
		options.eventHandler,
		"herdr",
	);
	const tabOptions: HerdrTabOptions = {
		commandRunner: options.commandRunner,
		spawnWorker: options.spawnWorker,
		publishClaimInProgress: (claimInProgress) =>
			statePublisher.publish(
				{ ...options.sessionState.moduleState.herdr, claimInProgress },
				{ persist: false },
			),
		hasClaimReturnedSuccessfully: () =>
			options.sessionState.moduleState.herdr.herdrClaimReturnedSuccessfully ===
			HERDR_CLAIM_RETURNED,
		onClaimReturnedSuccessfully: () =>
			statePublisher.publish(
				{
					...options.sessionState.moduleState.herdr,
					claimInProgress: false,
					herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
				},
				{ persist: true },
			),
	};
	installHerdrTabClaim(pi, tabOptions);
	return {};
}
