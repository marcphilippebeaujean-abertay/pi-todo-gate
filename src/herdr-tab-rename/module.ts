import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./events.ts";
import "./user-prompts.ts";
import "./notifications.ts";

import { createModuleStatePublisher } from "../event-publishers.ts";
import { isInsideHerdr } from "../shared/herdr-client.ts";
import { HERDR_CLAIM_RETURNED } from "./constants.ts";
import type {
	HerdrTabRenameModuleSetupOptions,
	HerdrTabRenameOptions,
} from "./internal-state.ts";

export type HerdrTabRenameModule = Record<never, never>;

import { installHerdrTabRename } from "./event-consumers.ts";

export * from "./module-state.ts";

export function createHerdrTabRenameModule(
	pi: Parameters<typeof installHerdrTabRename>[0],
	options: HerdrTabRenameModuleSetupOptions,
): HerdrTabRenameModule {
	const isUnavailable = !isInsideHerdr();
	if (isUnavailable) return {};
	const statePublisher = createModuleStatePublisher(
		options.eventHandler,
		"herdrTabRename",
	);
	const tabOptions: HerdrTabRenameOptions = {
		herdrClient: options.herdrClient,
		sessionState: options.sessionState,
		spawnWorker: options.spawnWorker,
		publishClaimInProgress: (claimInProgress) =>
			statePublisher.publish(
				{ ...options.sessionState.moduleState.herdrTabRename, claimInProgress },
				{ persist: false },
			),
		hasClaimReturnedSuccessfully: () =>
			options.sessionState.moduleState.herdrTabRename
				.herdrClaimReturnedSuccessfully === HERDR_CLAIM_RETURNED,
		onClaimReturnedSuccessfully: () =>
			statePublisher.publish(
				{
					...options.sessionState.moduleState.herdrTabRename,
					claimInProgress: false,
					herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
				},
				{ persist: true },
			),
	};
	installHerdrTabRename(pi, tabOptions);
	return {};
}
