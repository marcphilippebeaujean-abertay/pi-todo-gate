export type ExitActionId = "remove-worktree";

export type ExitActionResult = "completed" | "failed";

export interface ExitAction {
	id: ExitActionId;
	label: string;
	execute(): Promise<ExitActionResult>;
}
