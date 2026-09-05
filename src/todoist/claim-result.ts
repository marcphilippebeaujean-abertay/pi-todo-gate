const CLAIMED_STATUS = "claimed";
const COLLISION_STATUS = "collision";
const NONE_STATUS = "none";

import { Value } from "typebox/value";
import { textFromAssistantMessage } from "../shared/pi-worker.ts";
import { isRecord } from "../shared/records.ts";
import {
	type TaskClaimWorkerResult,
	TaskClaimWorkerResultSchema,
} from "./claim-worker.ts";

function isNonEmptyString(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return value.length > 0;
}

function parseWrappedResult(value: unknown): TaskClaimWorkerResult | undefined {
	const isWrappedRecord = isRecord(value);
	const wrappedRecord = isWrappedRecord ? value : null;
	if (wrappedRecord === null) return undefined;
	const wrapped = wrappedRecord as {
		claimed?: { taskRef?: unknown };
		collision?: {
			taskRef?: unknown;
			taskName?: unknown;
			collisionReason?: unknown;
		};
	};
	const claimedTaskRef = wrapped.claimed?.taskRef;
	const hasClaimedTaskRef = isNonEmptyString(claimedTaskRef);
	if (hasClaimedTaskRef)
		return {
			status: CLAIMED_STATUS,
			taskRef: claimedTaskRef,
		};
	const collisionTaskRef = wrapped.collision?.taskRef;
	const hasCollisionTaskRef = isNonEmptyString(collisionTaskRef);
	if (!hasCollisionTaskRef) return undefined;
	const collision = wrapped.collision;
	if (collision === undefined) return undefined;
	const hasTaskName = typeof collision.taskName === "string";
	const taskName = hasTaskName
		? { taskName: collision.taskName as string }
		: {};
	const hasCollisionReason = typeof collision.collisionReason === "string";
	const collisionReason = hasCollisionReason
		? { collisionReason: collision.collisionReason as string }
		: {};
	return {
		status: COLLISION_STATUS,
		taskRef: collisionTaskRef,
		...taskName,
		...collisionReason,
	};
}

export function parseResult(stdout: string): TaskClaimWorkerResult {
	const texts: string[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line) as { message?: unknown };
			const text = textFromAssistantMessage(event.message, "");
			texts.push(text);
		} catch {
			// Ignore non-JSON process output.
		}
	}

	for (let index = texts.length - 1; index >= 0; index -= 1) {
		const text = texts[index].trim();
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		const hasInvalidBounds = start < 0 || end <= start;
		if (hasInvalidBounds) continue;
		try {
			const value: unknown = JSON.parse(text.slice(start, end + 1));
			const isValidResult = Value.Check(TaskClaimWorkerResultSchema, value);
			if (isValidResult) return value as TaskClaimWorkerResult;
			const wrappedResult = parseWrappedResult(value);
			if (wrappedResult !== undefined) return wrappedResult;
		} catch {
			// Try earlier assistant output.
		}
	}
	return { status: NONE_STATUS };
}
