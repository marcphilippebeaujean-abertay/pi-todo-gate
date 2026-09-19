import type { HerdrClient } from "../shared/herdr-client.ts";
import { HERDR_COMMAND, TAB_GET_COMMAND } from "./constants.ts";

export type { CwdReference, HerdrClient } from "../shared/herdr-client.ts";
export {
	boundHerdrClient,
	isInsideHerdr,
	runHerdrCommand as runCommand,
} from "../shared/herdr-client.ts";

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

export function tabLabel(herdrClient: HerdrClient): string | undefined {
	const tabId = process.env.HERDR_TAB_ID;
	const hasTabId = Boolean(tabId);
	if (!hasTabId) return undefined;
	const resolvedTabId = tabId ?? "";
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		herdrClient(HERDR_COMMAND, [
			TAB_GET_COMMAND[0],
			TAB_GET_COMMAND[1],
			resolvedTabId,
		]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}
