import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	MERGE_COMMAND,
	MERGE_DESCRIPTION,
	mergeProtocolSkillPath,
} from "./constants.ts";
import type { CommandDependencies } from "./internal-state.ts";
import { notifyInactive, notifyNoPr, notifyNoUi } from "./notifications.ts";
import { confirmMerge } from "./user-prompts.ts";

export function register(dependencies: CommandDependencies): void {
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
	const hasCurrentContext = currentContext !== null;
	const isCurrentContext = dependencies.isCurrent(context);
	const canMerge = hasCurrentContext && isCurrentContext;
	if (!canMerge) {
		notifyInactive(context);
		return;
	}
	const hasUi = context.hasUI && currentContext.hasUI;
	if (!hasUi) {
		notifyNoUi(context);
		return;
	}
	const prUrl = dependencies.sessionState.moduleState.pr.prUrl;
	const hasValidPrUrl = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasValidPrUrl) {
		notifyNoPr(context);
		return;
	}
	await dependencies.queue
		.enqueue(async (isCurrent) => {
			const isCurrentBeforePrompt =
				isCurrent() && dependencies.isCurrent(context);
			if (!isCurrentBeforePrompt) return;
			const confirmed = await confirmMerge(context, prUrl);
			const isCurrentAfterPrompt =
				isCurrent() && dependencies.isCurrent(context);
			const shouldMerge = isCurrentAfterPrompt && confirmed;
			if (!shouldMerge) return;
			const isCurrentBeforeCapability =
				isCurrent() && dependencies.isCurrent(context);
			if (!isCurrentBeforeCapability) return;
			await dependencies.pr.mergeActivePr();
		})
		.catch(() => undefined);
}
