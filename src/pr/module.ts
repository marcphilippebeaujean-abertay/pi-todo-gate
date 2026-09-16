import "./commands.ts";
import "./constants.ts";
import "./events.ts";
import "./event-publishers.ts";
import "./git.ts";
import "./notifications.ts";
import "./parsing.ts";
import "./user-prompts.ts";
import "./state-tool.ts";
import { PrConsumer } from "./event-consumers.ts";
import type { PrModuleOptions } from "./internal-state.ts";

export * from "./module-state.ts";
export interface PrModule {
	mergeActivePr(): Promise<boolean>;
}

export function createPrModule(options: PrModuleOptions): PrModule {
	return new PrConsumer(options) as PrModule;
}
