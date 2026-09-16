import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PrModule } from "../pr/module.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";
import {
	MERGE_COMMAND,
	MERGE_DESCRIPTION,
	mergeProtocolSkillPath,
} from "./constants.ts";
import { notifyInactive, notifyNoPr, notifyNoUi } from "./notifications.ts";
import type { PromptQueue } from "./queue.ts";
import { confirmMerge } from "./user-prompts.ts";

export interface CommandDependencies {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule;
	queue: PromptQueue;
	getContext: () => ExtensionContext | null;
	isCurrent: (context: ExtensionContext) => boolean;
}

export function registerPromptQueueCommands(
	dependencies: CommandDependencies,
): void {
	const pi = dependencies.pi;
	if (pi === undefined) return;
	pi.on("resources_discover", () => ({ skillPaths: [mergeProtocolSkillPath] }));
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(MERGE_COMMAND, {
		description: MERGE_DESCRIPTION,
		handler: (_args: string, context: ExtensionCommandContext) =>
			runMerge(dependencies, context),
	});
}

async function runMerge(
	dependencies: CommandDependencies,
	context: ExtensionCommandContext,
): Promise<void> {
	const currentContext = dependencies.getContext();
	if (currentContext === null || !dependencies.isCurrent(context)) {
		notifyInactive(context);
		return;
	}
	if (!context.hasUI || !currentContext.hasUI) {
		notifyNoUi(context);
		return;
	}
	const prUrl = dependencies.sessionState.moduleState.pr.prUrl;
	if (typeof prUrl !== "string" || prUrl.trim() === "") {
		notifyNoPr(context);
		return;
	}
	const confirmed = await confirmMerge(context, prUrl);
	if (!dependencies.isCurrent(context) || !confirmed) return;
	await dependencies.pr.mergeActivePr();
}
