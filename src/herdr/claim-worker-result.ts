import { textFromAssistantMessage } from "../shared/pi-worker.ts";
import { HERDR_OBJECT_TYPE, MAX_DIAGNOSTIC_BYTES } from "./constants.ts";

import type { ClaimWorkerResponse } from "./state.ts";

export function appendBounded(current: string, chunk: Buffer | string): string {
	const next = `${current}${chunk.toString()}`;
	const exceedsLimit = next.length > MAX_DIAGNOSTIC_BYTES;
	return exceedsLimit ? next.slice(-MAX_DIAGNOSTIC_BYTES) : next;
}

function claimResult(value: unknown): ClaimWorkerResponse | undefined {
	const isNull = value === null;
	if (isNull) return null;
	const isObject = typeof value === HERDR_OBJECT_TYPE;
	const isInvalidObject = !isObject || Array.isArray(value);
	if (isInvalidObject) return undefined;
	const result = value as Partial<Exclude<ClaimWorkerResponse, null>>;
	const tabName = result.tabName;
	const shouldMoveToNewTab = result.shouldMoveToNewTab;
	const hasTabName = typeof tabName === "string";
	const hasNonEmptyTabName = hasTabName && tabName.trim().length > 0;
	const hasMoveFlag = typeof shouldMoveToNewTab === "boolean";
	const isInvalidResult = !hasNonEmptyTabName || !hasMoveFlag;
	if (isInvalidResult) return undefined;
	return { tabName, shouldMoveToNewTab };
}

export function parseClaimResult(
	stdout: string,
): ClaimWorkerResponse | undefined {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		const hasLine = line.trim().length > 0;
		if (!hasLine) continue;
		try {
			const event = JSON.parse(line) as { message?: unknown };
			const text = textFromAssistantMessage(event.message).trim();
			const hasText = text.length > 0;
			const result = hasText
				? claimResult(JSON.parse(text))
				: claimResult(event);
			const hasResult = result !== undefined;
			if (hasResult) return result;
		} catch {
			// Keep searching earlier worker output.
		}
	}
	return undefined;
}
