const TODOIST_ERROR_NAME = "TodoistError";
const OPERATION_CANCELLED = "Todoist operation cancelled";

export class TodoistOperationCancelled extends Error {
	constructor() {
		super(OPERATION_CANCELLED);
	}
}

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		super(`Todoist ${commandFamily} failed${detail ? `: ${detail}` : ""}`);
		this.name = TODOIST_ERROR_NAME;
		this.commandFamily = commandFamily;
	}
}
