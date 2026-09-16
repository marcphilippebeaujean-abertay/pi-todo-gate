export type ExitActionId = "remove-worktree";
export type ExitActionResult = "completed" | "failed";
export interface ExitAction {
	id: ExitActionId;
	label: string;
	defaultAnswer?: "yes" | "no";
	execute(): Promise<ExitActionResult>;
}
