import { textFromAssistantMessage } from "../shared/pi-worker.ts";
import {
	CLAIMED_STATUS,
	HERDR_OBJECT_TYPE,
	MAX_DIAGNOSTIC_BYTES,
} from "./constants.ts";

export interface ClaimWorkerResult {
	tabId: string;
	label: string;
}

export function appendBounded(current: string, chunk: Buffer | string): string {
	const next = `${current}${chunk.toString()}`;
	const exceedsLimit = next.length > MAX_DIAGNOSTIC_BYTES;
	return exceedsLimit ? next.slice(-MAX_DIAGNOSTIC_BYTES) : next;
}

function claimResult(value: unknown): ClaimWorkerResult | undefined {
	const isObject = typeof value === HERDR_OBJECT_TYPE;
	const isNull = value === null;
	const isInvalidValue = !isObject || isNull;
	if (isInvalidValue) return undefined;
	const result = value as {
		status?: unknown;
		tabId?: unknown;
		label?: unknown;
	};
	const hasClaimedStatus = result.status === CLAIMED_STATUS;
	const hasTabId = typeof result.tabId === "string";
	const hasNonEmptyTabId = hasTabId && (result.tabId as string).trim() !== "";
	const hasLabel = typeof result.label === "string";
	const hasNonEmptyLabel = hasLabel && (result.label as string).trim() !== "";
	if (!hasClaimedStatus) return undefined;
	if (!hasNonEmptyTabId) return undefined;
	if (!hasNonEmptyLabel) return undefined;
	return { tabId: result.tabId as string, label: result.label as string };
}

export function parseClaimResult(
	stdout: string,
): ClaimWorkerResult | undefined {
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
