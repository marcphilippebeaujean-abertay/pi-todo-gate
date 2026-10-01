import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { HerdrClient } from "../shared/herdr-client.ts";
import type { SessionState } from "../state.ts";

export interface ReviewCommandDependencies {
	sessionState: SessionState;
	herdrClient?: HerdrClient;
	sleep?: (milliseconds: number) => Promise<void>;
}

export interface ReviewModuleOptions extends ReviewCommandDependencies {
	pi: ExtensionAPI;
}

export type ReviewCommandHandler = (
	args: string,
	context: ExtensionCommandContext,
) => Promise<void>;
