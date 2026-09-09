import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FooterEventSink } from "../footer/data.ts";
import { textFromAssistantMessage } from "../shared/pi-worker.ts";

export interface ClaimWorkerResult {
	tabId: string;
	label: string;
}

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	onClaimComplete: (result?: ClaimWorkerResult) => void;
	onFailure: (message: string) => void;
}
export interface ClaimWorkerHandle {
	cancel(): void;
}
export interface WorkerOutputStream {
	on(event: "data", listener: (chunk: Buffer | string) => void): void;
}
export interface WorkerProcess {
	stdout: WorkerOutputStream;
	stderr: WorkerOutputStream;
	on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
	kill(signal?: NodeJS.Signals): boolean;
}
export type WorkerSpawner = (
	command: string,
	args: readonly string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		shell: false;
		stdio: ["ignore", "pipe", "pipe"];
	},
) => WorkerProcess;

const MAX_DIAGNOSTIC_BYTES = 500;
const HERDR_OBJECT_TYPE = "object";
const CLAIMED_STATUS = "claimed";

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
const CUSTOM_ENTRY = "custom";
const HERDR_STATE_TYPE = "pi-todo-gate-herdr-state";
const RAN = "ran";

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObject = typeof value === HERDR_OBJECT_TYPE;
	if (!isObject) return false;
	const isNull = value === null;
	if (isNull) return false;
	return !Array.isArray(value);
}

export function hasHerdrClaimRun(entries: readonly unknown[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		const isRecordEntry = isRecord(entry);
		if (!isRecordEntry) continue;
		const isHerdrState =
			entry.type === CUSTOM_ENTRY && entry.customType === HERDR_STATE_TYPE;
		if (!isHerdrState) continue;
		const data = entry.data;
		const hasRecordData = isRecord(data);
		if (!hasRecordData) continue;
		const hasRanFlag = data[RAN] === true;
		if (hasRanFlag) return true;
	}
	return false;
}

const HERDR_COMMAND = "herdr";
const TAB_GET_ARGS = ["tab", "get"];
const PANE_GET_ARGS = ["pane", "get"];
const STRING_TYPE = "string";
const NUMERIC_LABEL = /^\d+$/;

function labelIsDescriptive(label: string | undefined | null): boolean {
	const hasNoLabel = !label;
	if (hasNoLabel) return false;
	const value = label.trim();
	const hasValue = Boolean(value);
	const isNotNumeric = !NUMERIC_LABEL.test(value);
	return hasValue && isNotNumeric;
}

function matchesWorkerClaim(
	claim: ClaimWorkerResult | undefined,
	tabId: string,
	label: string,
): boolean {
	const hasClaim = claim !== undefined;
	if (!hasClaim) return false;
	const hasMatchingTab = claim.tabId === tabId;
	const hasMatchingLabel = claim.label === label;
	return hasMatchingTab && hasMatchingLabel;
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

function tabLabel(
	commandRunner: CommandRunner,
	tabId: string,
): string | undefined {
	const response = jsonResult<{
		result?: { tab?: { label?: unknown } };
	}>(commandRunner(HERDR_COMMAND, [...TAB_GET_ARGS, tabId]));
	const label = response?.result?.tab?.label;
	const hasLabel = typeof label === STRING_TYPE;
	return hasLabel ? (label as string).trim() : undefined;
}

function paneTabId(
	commandRunner: CommandRunner,
	paneId: string,
): string | undefined {
	const response = jsonResult<{
		result?: { pane?: { tab_id?: unknown } };
	}>(commandRunner(HERDR_COMMAND, [...PANE_GET_ARGS, paneId]));
	const tabId = response?.result?.pane?.tab_id;
	const hasTabId = typeof tabId === STRING_TYPE;
	const hasNonEmptyTabId = hasTabId && (tabId as string).length > 0;
	return hasNonEmptyTabId ? (tabId as string) : undefined;
}

export function hasValidatedTabClaim(
	commandRunner: CommandRunner,
	initialLabel: string | undefined,
	paneId: string | undefined,
	claim: ClaimWorkerResult | undefined,
): boolean {
	const hasInitialLabel = initialLabel !== undefined;
	if (!hasInitialLabel) return false;
	const hasPaneId = paneId !== undefined;
	if (!hasPaneId) return false;
	try {
		const observedTabId = paneTabId(commandRunner, paneId);
		const hasObservedTab = observedTabId !== undefined;
		if (!hasObservedTab) return false;
		const currentLabel = tabLabel(commandRunner, observedTabId);
		const hasDescriptiveLabel = labelIsDescriptive(currentLabel);
		const hasChangedLabel = currentLabel !== initialLabel;
		const hasMatchingWorkerClaim = matchesWorkerClaim(
			claim,
			observedTabId,
			currentLabel ?? "",
		);
		const hasClaimedOrChangedLabel = hasChangedLabel || hasMatchingWorkerClaim;
		const hasValidObservedClaim =
			hasDescriptiveLabel && hasClaimedOrChangedLabel;
		if (!hasValidObservedClaim) return false;
		const hasWorkerClaim = claim !== undefined;
		return !hasWorkerClaim || hasMatchingWorkerClaim;
	} catch {
		return false;
	}
}

export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface HerdrTabOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
	onFooterUpdate?: FooterEventSink;
}
