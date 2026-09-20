import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./events.ts";
import "./user-prompts.ts";
import "./notifications.ts";
import { isInsideHerdr } from "../shared/herdr-client.ts";
import { isSubagent } from "../shared/session.ts";
import { HerdrTabRenameConsumer } from "./event-consumers.ts";
import type { HerdrTabRenameModuleSetupOptions } from "./internal-state.ts";

export class HerdrTabRenameModule {
	constructor(pi: ExtensionAPI, options: HerdrTabRenameModuleSetupOptions) {
		const isUnavailable = !isInsideHerdr();
		if (isUnavailable) return;
		const shouldSkip = isSubagent();
		if (shouldSkip) return;
		new HerdrTabRenameConsumer(pi, {
			eventHandler: options.eventHandler,
			sessionState: options.sessionState,
			herdrClient: options.herdrClient,
			spawnWorker: options.spawnWorker,
		});
	}
}
