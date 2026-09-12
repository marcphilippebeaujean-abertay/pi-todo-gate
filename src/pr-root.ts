import { createPrModule } from "./pr/module.ts";
import type { PrSession, PrWorkState } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import type { EventHandler } from "./shared/events.ts";
import type { SessionState } from "./state.ts";

export interface PrRootDependencies {
	exec?: import("./shared/command.ts").Exec;
	appendState?: (state: PrWorkState, prDiscoveryDisabled?: boolean) => void;
	replaceSessionState?: (session: PrSession, state: PrWorkState) => void;
	refreshFooterStatuses?: (session: PrSession) => void;
}

export function createRootPrModule(
	promptQueue: PromptQueue,
	eventHandler: EventHandler,
	sessionState: SessionState,
	exec: PrRootDependencies["exec"],
	getSession: () => PrSession | null,
	dependencies?: Omit<PrRootDependencies, "exec">,
) {
	const moduleDependencies = dependencies ?? {};
	return createPrModule({
		promptQueue,
		eventHandler,
		sessionState,
		getSession,
		dependencies: { exec, ...moduleDependencies },
	});
}
