import "./commands.ts";
import "./constants.ts";
import "./data.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";
import "./footer-rendering.ts";

export * from "./footer-rendering.ts";
export type {
	FooterModule,
	FooterModuleDependencies,
	FooterSessionReader,
} from "./legacy/module.ts";
export { createFooterModule } from "./legacy/module.ts";
