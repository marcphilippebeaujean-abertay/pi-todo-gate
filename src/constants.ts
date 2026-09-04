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
		clearAll: "clear_all",
	},
	event: {
		sessionStart: "session_start",
		messageEnd: "message_end",
		beforeAgentStart: "before_agent_start",
		toolResult: "tool_result",
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
		inactive: "pi-todo-gate is inactive for this project",
		invalidPr: "set_pr requires a valid GitHub pull request URL",
		prCleared: "Cleared the pinned PR",
		stateCleared: "Cleared session PR state",
		lookupUnavailable:
			"GitHub PR lookup unavailable; verify gh authentication before creating the PR.",
		createPr:
			"When implementation is finished, push this branch and create a GitHub PR.",
		context: "pi-todo-gate-context",
		prDescription: "Inspect or change this session's pinned GitHub PR.",
		prPrompt: "inspect or update the session PR",
		merged: "Merged PR detected; Todoist task completed",
		mergedFailed: "Merged PR detected, but Todoist task completion failed",
	},
} as const;
