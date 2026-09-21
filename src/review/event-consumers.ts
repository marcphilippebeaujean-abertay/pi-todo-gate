import { isInsideHerdr } from "../shared/herdr-client.ts";
import { register } from "./commands.ts";
import type { ReviewModuleOptions } from "./internal-state.ts";

export class ReviewConsumer {
	constructor(options: ReviewModuleOptions) {
		const isUnavailable = !isInsideHerdr();
		if (isUnavailable) return;
		register(options.pi, options);
	}
}
