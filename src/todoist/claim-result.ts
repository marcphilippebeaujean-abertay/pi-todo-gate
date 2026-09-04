const INVALID_RESULT = "Invalid claim worker result.";
const EMPTY = String();
const CLAIM = "claim";
const ERROR = "error";

import { Value } from "typebox/value";
import { textFromAssistantMessage } from "../shared/pi-worker.ts";
import {
	type TaskClaimWorkerResult,
	TaskClaimWorkerResultSchema,
} from "./claim-worker.ts";

function invalidResult(): TaskClaimWorkerResult {
	return { action: ERROR, taskData: null, error: INVALID_RESULT };
}

function isValidActionData(result: TaskClaimWorkerResult): boolean {
	const hasTaskData = result.taskData !== null;
	const hasError = result.error !== null;
	const isErrorAction = result.action === ERROR;
	if (isErrorAction) return !hasTaskData && hasError;
	const hasInvalidTaskData = !hasTaskData;
	if (hasInvalidTaskData) return false;
	if (hasError) return false;
	const taskData = result.taskData;
	const hasMissingTaskData = taskData === null;
	if (hasMissingTaskData) return false;
	const hasId = taskData.id !== null;
	const isClaimAction = result.action === CLAIM;
	return isClaimAction ? hasId : !hasId;
}

function parseCandidate(text: string): TaskClaimWorkerResult | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	const hasInvalidBounds = start < 0 || end <= start;
	if (hasInvalidBounds) return undefined;
	try {
		const value: unknown = JSON.parse(text.slice(start, end + 1));
		const isSchemaResult = Value.Check(TaskClaimWorkerResultSchema, value);
		if (!isSchemaResult) return undefined;
		const result = value as TaskClaimWorkerResult;
		return isValidActionData(result) ? result : undefined;
	} catch {
		return undefined;
	}
}

function assistantTexts(stdout: string): string[] {
	const texts: string[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line) as { message?: unknown };
			const text = textFromAssistantMessage(event.message, EMPTY);
			const hasText = text !== EMPTY;
			if (hasText) texts.push(text);
		} catch {
			// Ignore non-JSON process output.
		}
	}
	return texts;
}

export function parseResult(stdout: string): TaskClaimWorkerResult {
	const texts = assistantTexts(stdout);
	for (let index = texts.length - 1; index >= 0; index -= 1) {
		const result = parseCandidate(texts[index].trim());
		const hasResult = result !== undefined;
		if (hasResult) return result;
	}
	return invalidResult();
}
