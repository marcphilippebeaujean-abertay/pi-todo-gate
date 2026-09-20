import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./events.ts";
import "./user-prompts.ts";
import "./notifications.ts";

import { createModuleStatePublisher } from "../event-publishers.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { withLoading } from "../shared/events.ts";
import { isInsideHerdr } from "../shared/herdr-client.ts";
import { isSubagent } from "../shared/session.ts";
import { HERDR_CLAIM_RETURNED } from "./constants.ts";
import { HerdrTabRenameConsumer } from "./event-consumers.ts";
import { createHerdrEvents } from "./events.ts";
import type {
	HerdrTabRenameModuleSetupOptions,
	HerdrTabRenameOptions,
} from "./internal-state.ts";

export class HerdrTabRenameModule {
	constructor(pi: ExtensionAPI, options: HerdrTabRenameModuleSetupOptions) {
		const isUnavailable = !isInsideHerdr();
		if (isUnavailable) return;
		const shouldSkip = isSubagent();
		if (shouldSkip) return;
		const statePublisher = createModuleStatePublisher(
			options.eventHandler,
			"herdrTabRename",
		);
		const tabOptions: HerdrTabRenameOptions = {
			herdrClient: options.herdrClient,
			sessionState: options.sessionState,
			spawnWorker: options.spawnWorker,
			withLoading: (operation) =>
				withLoading(options.eventHandler, C.action.herdrTabRename, operation),
			hasClaimReturnedSuccessfully: () =>
				options.sessionState.moduleState.herdrTabRename
					.herdrClaimReturnedSuccessfully === HERDR_CLAIM_RETURNED,
			onClaimReturnedSuccessfully: () =>
				statePublisher.publish(
					{
						...options.sessionState.moduleState.herdrTabRename,
						herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
					},
					{ persist: true },
				),
		};
		new HerdrTabRenameConsumer(pi, tabOptions, createHerdrEvents());
	}
}
