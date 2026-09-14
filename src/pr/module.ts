import "./commands.ts";
import "./constants.ts";
import "./events.ts";
import "./event-publishers.ts";
import "./git.ts";
import "./notifications.ts";
import "./parsing.ts";
import "./state-tool.ts";
import "./user-prompts.ts";
import { PrConsumer } from "./event-consumers.ts";
import type { PrModuleOptions } from "./internal-state.ts";

export { register as registerMergeProtocol } from "./commands.ts";
export * from "./module-state.ts";
export type PrModule = Record<never, never>;

export function createPrModule(options: PrModuleOptions): PrModule {
	return new PrConsumer(options) as PrModule;
}

export { mergeProtocolSkillPath } from "./constants.ts";
