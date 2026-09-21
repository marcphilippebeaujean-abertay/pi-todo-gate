import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./events.ts";
import "./user-prompts.ts";
import "./notifications.ts";

import { isInsideHerdr } from "../shared/herdr-client.ts";
import { installHerdrTabRename } from "./event-consumers.ts";
import type { HerdrTabRenameModuleSetupOptions } from "./internal-state.ts";

export type HerdrTabRenameModule = Record<never, never>;

export * from "./module-state.ts";

export function createHerdrTabRenameModule(
	pi: Parameters<typeof installHerdrTabRename>[0],
	options: HerdrTabRenameModuleSetupOptions,
): HerdrTabRenameModule {
	const isUnavailable = !isInsideHerdr();
	if (isUnavailable) return {};
	installHerdrTabRename(pi, {
		eventHandler: options.eventHandler,
		sessionState: options.sessionState,
		herdrClient: options.herdrClient,
		spawnWorker: options.spawnWorker,
	});
	return {};
}
