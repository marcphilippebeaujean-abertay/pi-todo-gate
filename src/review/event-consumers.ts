import { register } from "./commands.ts";
import type { ReviewModuleOptions } from "./internal-state.ts";

export function registerReviewOnActivation(options: ReviewModuleOptions): void {
	let registered = false;
	options.eventHandler?.sessionActivatedEvent.subscribe(({ session }) => {
		const isAlreadyRegistered = registered;
		const isNonGitProject = session?.project?.isGitProject === false;
		const shouldSkip = isAlreadyRegistered || isNonGitProject;
		if (shouldSkip) return;
		registered = true;
		register(options.pi, options);
	});
}
