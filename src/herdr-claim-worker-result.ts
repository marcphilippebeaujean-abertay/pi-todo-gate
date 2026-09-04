import { textFromAssistantMessage } from "./shared/pi-worker.ts";

export interface ClaimWorkerResult {
	tabId: string;
	label: string;
}

const MAX_DIAGNOSTIC_BYTES = 500;
const OBJECT_TYPE = "object";
const CLAIMED_STATUS = "claimed";

export function appendBounded(current: string, chunk: Buffer | string): string {
	const next = `${current}${chunk.toString()}`;
	const exceedsLimit = next.length > MAX_DIAGNOSTIC_BYTES;
	return exceedsLimit ? next.slice(-MAX_DIAGNOSTIC_BYTES) : next;
}

function claimResult(value: unknown): ClaimWorkerResult | undefined {
	const isObject = typeof value === OBJECT_TYPE;
	const isNull = value === null;
	const isInvalidValue = !isObject || isNull;
	if (isInvalidValue) return undefined;
	const result = value as {
		status?: unknown;
		tabId?: unknown;
		label?: unknown;
	};
	const hasClaimedStatus = result.status === CLAIMED_STATUS;
	const hasTabId =
		typeof result.tabId === "string" && result.tabId.trim().length > 0;
	const hasLabel =
		typeof result.label === "string" && result.label.trim().length > 0;
	if (!hasClaimedStatus) return undefined;
	if (!hasTabId) return undefined;
	if (!hasLabel) return undefined;
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
