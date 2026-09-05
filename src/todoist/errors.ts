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
		const hasDetail = detail !== "";
		const detailSuffix = hasDetail ? `: ${detail}` : "";
		super(`Todoist ${commandFamily} failed${detailSuffix}`);
		this.name = TODOIST_ERROR_NAME;
		this.commandFamily = commandFamily;
	}
}
