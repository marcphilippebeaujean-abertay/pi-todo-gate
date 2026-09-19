import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";

import { isInsideHerdr } from "../shared/herdr-client.ts";
import { register } from "./commands.ts";
import { registerReviewOnActivation } from "./event-consumers.ts";
import type { ReviewModuleOptions } from "./internal-state.ts";

export type ReviewModule = Record<never, never>;

export { reviewStateDescriptor } from "./module-state.ts";

export function createReviewModule(options: ReviewModuleOptions): ReviewModule {
	const isUnavailable = !isInsideHerdr();
	if (isUnavailable) return {};
	const shouldRegisterImmediately = !options.deferRegistration;
	if (shouldRegisterImmediately) register(options.pi, options);
	if (!shouldRegisterImmediately) registerReviewOnActivation(options);
	return {};
}
