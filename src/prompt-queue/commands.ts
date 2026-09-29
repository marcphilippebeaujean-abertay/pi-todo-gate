import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { MERGE_COMMAND, MERGE_DESCRIPTION } from "./constants.ts";
import type { CommandDependencies } from "./internal-state.ts";
import { notifyInactive, notifyNoPr, notifyNoUi } from "./notifications.ts";
import { confirmMerge } from "./user-prompts.ts";

export function register(dependencies: CommandDependencies): void {
	const pi = dependencies.pi;
	if (pi === undefined) return;
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(MERGE_COMMAND, {
		description: MERGE_DESCRIPTION,
		handler: (_args: string, context: ExtensionCommandContext) =>
			runMerge(dependencies, context),
	});
}

async function confirmCurrentMerge(
	dependencies: CommandDependencies,
	context: ExtensionCommandContext,
	prUrl: string,
	isCurrent: () => boolean,
): Promise<boolean | null> {
	const worktree = dependencies.worktree;
	const hasWorktreeModule = worktree !== null;
	if (hasWorktreeModule) {
		const status = await worktree.hasUncommittedChanges();
		if (status === null) return null;
	}
	const isCurrentAfterStatus = isCurrent() && dependencies.isCurrent(context);
	if (!isCurrentAfterStatus) return null;
	const worktreeRoot = dependencies.sessionState.gitState.worktreeRoot;
	const hasWorktreeRoot = typeof worktreeRoot === "string";
	return confirmMerge(context, prUrl, {
		worktreePath: hasWorktreeRoot ? worktreeRoot : undefined,
		hasUncommittedChanges:
			dependencies.sessionState.gitState.hasUncommittedChanges === true,
	});
}

async function runQueuedMerge(
	dependencies: CommandDependencies,
	context: ExtensionCommandContext,
	prUrl: string,
	isCurrent: () => boolean,
	pr: NonNullable<CommandDependencies["pr"]>,
): Promise<void> {
	const isCurrentBeforePrompt = isCurrent() && dependencies.isCurrent(context);
	if (!isCurrentBeforePrompt) return;
	const confirmed = await confirmCurrentMerge(
		dependencies,
		context,
		prUrl,
		isCurrent,
	);
	if (confirmed === null) return;
	const isCurrentAfterPrompt = isCurrent() && dependencies.isCurrent(context);
	const shouldMerge = isCurrentAfterPrompt && confirmed;
	if (!shouldMerge) return;
	const isCurrentBeforeCapability =
		isCurrent() && dependencies.isCurrent(context);
	if (!isCurrentBeforeCapability) return;
	await pr.mergeActivePr(context);
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
	const pr = dependencies.pr;
	const hasPrModule = pr !== null;
	if (!hasPrModule) {
		notifyInactive(context);
		return;
	}
	const prUrl = dependencies.sessionState.moduleState.pr.prUrl;
	const hasValidPrUrl = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasValidPrUrl) {
		notifyNoPr(context);
		return;
	}
	await dependencies.queue
		.enqueue((isCurrent) =>
			runQueuedMerge(dependencies, context, prUrl, isCurrent, pr),
		)
		.catch(() => undefined);
}
