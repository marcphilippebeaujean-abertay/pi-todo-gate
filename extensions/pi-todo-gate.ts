import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../src/constants.ts";
import {
	handleAgentSettled,
	handleBeforeAgentStart,
	handleMessageEnd,
	handleToolResult,
} from "../src/extension-events.ts";
import { createExtensionRuntime } from "../src/extension-runtime.ts";
import {
	handleSessionShutdown,
	handleSessionStart,
} from "../src/extension-session.ts";
import type { ExtensionDependencies } from "../src/extension-types.ts";
import { installHerdrClaimGate } from "../src/herdr-claim-gate.ts";

export type {
	ExtensionDependencies,
	WorkStateAction,
} from "../src/extension-types.ts";

const SUBAGENT_ENVIRONMENT = "PI_SUBAGENT_CHILD";

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	const isSubagent = process.env[SUBAGENT_ENVIRONMENT] !== undefined;
	if (isSubagent) return;
	const runtime = createExtensionRuntime(pi, dependencies);
	pi.on(C.event.sessionStart, handleSessionStart.bind(null, runtime));
	pi.on(C.event.messageEnd, handleMessageEnd.bind(null, runtime));
	pi.on(C.event.beforeAgentStart, handleBeforeAgentStart.bind(null, runtime));
	pi.on(C.event.toolResult, handleToolResult.bind(null, runtime));
	pi.on(C.event.agentSettled, handleAgentSettled.bind(null, runtime));
	pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, runtime));
	installHerdrClaimGate(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
	});
}
