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
import {
	FOOTER_HERDR_TYPE,
	FOOTER_HERDR_WORKING_STATUS,
} from "../footer/constants.ts";
import { publishFooterUpdate } from "../footer/event-publishers.ts";
import { withLoading } from "../shared/events.ts";
import { HERDR_CLAIM_RETURNED } from "./constants.ts";
import type {
	HerdrModuleSetupOptions,
	HerdrTabOptions,
} from "./internal-state.ts";
import { isInsideHerdr } from "./runtime.ts";

export type HerdrModule = Record<never, never>;

import { installHerdrTabClaim } from "./event-consumers.ts";

export * from "./module-state.ts";

function withHerdrLoading(
	eventHandler: HerdrModuleSetupOptions["eventHandler"],
	operation: () => Promise<void>,
): Promise<void> {
	void publishFooterUpdate(eventHandler, {
		footerType: FOOTER_HERDR_TYPE,
		text: FOOTER_HERDR_WORKING_STATUS,
		isVisible: true,
	});
	return withLoading(eventHandler, FOOTER_HERDR_TYPE, operation, () =>
		publishFooterUpdate(eventHandler, {
			footerType: FOOTER_HERDR_TYPE,
			text: FOOTER_HERDR_WORKING_STATUS,
			isVisible: false,
		}),
	);
}

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
		herdrClient: options.herdrClient,
		spawnWorker: options.spawnWorker,
		withLoading: (operation) =>
			withHerdrLoading(options.eventHandler, operation),
		hasClaimReturnedSuccessfully: () =>
			options.sessionState.moduleState.herdr.herdrClaimReturnedSuccessfully ===
			HERDR_CLAIM_RETURNED,
		onClaimReturnedSuccessfully: () =>
			statePublisher.publish(
				{
					...options.sessionState.moduleState.herdr,
					herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
				},
				{ persist: true },
			),
	};
	installHerdrTabClaim(pi, tabOptions);
	return {};
}
