export const EXTENSION_CONSTANTS = {
	content: {
		text: "text",
		content: "content",
	},
	entry: {
		custom: "custom",
		state: "pi-todo-gate-state",
	},
	command: {
		todoist: "td",
	},
	status: {
		pr: "pi-todo-gate-pr",
		task: "pi-todo-gate-task",
	},
	action: {
		status: "status",
		setPr: "set_pr",
		clearPr: "clear_pr",
		setTask: "set_task",
		clearTask: "clear_task",
		clearAll: "clear_all",
	},
	event: {
		sessionStart: "session_start",
		messageEnd: "message_end",
		beforeAgentStart: "before_agent_start",
		toolResult: "tool_result",
		agentSettled: "agent_settled",
		sessionShutdown: "session_shutdown",
	},
	tool: {
		state: "pi_todo_gate_state",
		todoist: "Todo Gate State",
		edit: "edit",
		write: "write",
		bash: "bash",
	},
	value: {
		none: "none",
		unknown: "unknown",
		warning: "warning",
		info: "info",
		tui: "tui",
	},
	message: {
		taskNotLinked: "Todoist task was not linked from session history",
		taskUpdateFailed: "Todoist task update failed",
		inactive: "pi-todo-gate is inactive for this project",
		invalidPr: "set_pr requires a valid GitHub pull request URL",
		prCleared: "Cleared the pinned PR",
		invalidTask: "set_task requires a Todoist task reference",
		taskCleared: "Cleared the claimed Todoist task",
		stateCleared: "Cleared session PR and task links",
		lookupUnavailable:
			"GitHub PR lookup unavailable; verify gh authentication before creating the PR.",
		createPr:
			"When implementation is finished, push this branch and create a GitHub PR.",
		context: "pi-todo-gate-context",
		prDescription:
			"Inspect or change this session's pinned GitHub PR and claimed Todoist task.",
		prPrompt: "inspect or update the session PR and Todoist task",
		merged: "Merged PR detected; Todoist task completed",
		mergedFailed: "Merged PR detected, but Todoist task completion failed",
	},
} as const;
