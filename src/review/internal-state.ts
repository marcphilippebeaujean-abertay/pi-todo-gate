import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { EventHandler } from "../shared/events.ts";
import type { HerdrClient } from "../shared/herdr-client.ts";
import type { SessionState } from "../state.ts";

export interface ReviewCommandDependencies {
	sessionState: SessionState;
	herdrClient?: HerdrClient;
}

export interface ReviewModuleOptions extends ReviewCommandDependencies {
	pi: ExtensionAPI;
	eventHandler?: EventHandler;
	deferRegistration?: boolean;
}

export type ReviewCommandHandler = (
	args: string,
	context: ExtensionCommandContext,
) => Promise<void>;
