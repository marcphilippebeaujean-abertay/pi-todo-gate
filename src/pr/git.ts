import type { CommandResult, Exec } from "../shared/command.ts";
import { githubPrUrl } from "./detection.ts";

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

export async function findPrState(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<OpenPrInfo["state"]> {
	let result: CommandResult;
	try {
		result = await exec(
			"gh",
			["pr", "view", prUrl, "--json", "state,mergedAt"],
			{ cwd },
		);
	} catch {
		return "UNKNOWN";
	}
	if (result.code !== 0) return "UNKNOWN";
	try {
		const row: unknown = JSON.parse(result.stdout);
		if (typeof row !== "object" || row === null) return "UNKNOWN";
		const data = row as { state?: unknown; mergedAt?: unknown };
		if (
			data.state === "MERGED" &&
			typeof data.mergedAt === "string" &&
			data.mergedAt.trim() !== ""
		)
			return "MERGED";
		if (data.state === "OPEN" || data.state === "CLOSED") return data.state;
		return "UNKNOWN";
	} catch {
		return "UNKNOWN";
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	let result: CommandResult;
	try {
		result = await exec(
			"gh",
			[
				"pr",
				"list",
				"--head",
				branch,
				"--state",
				"open",
				"--json",
				"url,state",
				"--limit",
				"1",
			],
			{ cwd },
		);
	} catch {
		return { url: null, state: "UNKNOWN" };
	}
	if (result.code !== 0) return { url: null, state: "UNKNOWN" };
	try {
		const rows: unknown = JSON.parse(result.stdout);
		if (!Array.isArray(rows)) return { url: null, state: "UNKNOWN" };
		if (rows.length === 0) return { url: null, state: "OPEN" };
		if (typeof rows[0] !== "object" || rows[0] === null) {
			return { url: null, state: "UNKNOWN" };
		}
		const row = rows[0] as { url?: unknown; state?: unknown };
		const url = typeof row.url === "string" ? githubPrUrl(row.url) : null;
		const state =
			row.state === "OPEN" || row.state === "CLOSED" || row.state === "MERGED"
				? row.state
				: "UNKNOWN";
		return { url, state };
	} catch {
		return { url: null, state: "UNKNOWN" };
	}
}

export {
	detectMerge,
	matchesPinnedPr,
	mergeCommand,
} from "../shared/merge-detection.ts";
