export type ExitActionId = "remove-worktree";

export type ExitActionResult = "completed" | "deferred" | "failed";

export interface ExitAction {
	id: ExitActionId;
	label: string;
	execute(): Promise<ExitActionResult>;
}
