const STRING_LITERAL_PI_71984658 = ".pi";
const STRING_LITERAL_AGENT_04BC23DA = "agent";
const STRING_LITERAL_PI_TODO_GATE_JSON_67D8A0C1 = "pi-todo-gate.json";
const STRING_LITERAL_UTF8_D89108E9 = "utf8";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isPathAtOrBelow, normalizedPath } from "../shared/path.ts";
import { isRecord } from "../shared/records.ts";
import { parseProjectEntry } from "./config-entry.ts";
export interface TodoistProjectSettings {
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export interface TodoistProjectMapping {
	projects: Record<string, string | TodoistProjectSettings>;
}

export interface ResolvedProject {
	codingRoot: string;
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export function defaultConfigPath(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR ??
		join(homedir(), STRING_LITERAL_PI_71984658, STRING_LITERAL_AGENT_04BC23DA);
	return join(agentDir, STRING_LITERAL_PI_TODO_GATE_JSON_67D8A0C1);
}

export const DEFAULT_CONFIG_PATH = defaultConfigPath();

export function parseConfig(raw: string): TodoistProjectMapping {
	try {
		const parsed: unknown = JSON.parse(raw);
		const record = isRecord(parsed) ? parsed : null;
		if (record === null) return { projects: {} };
		const projectRecord = isRecord(record.projects) ? record.projects : null;
		if (projectRecord === null) return { projects: {} };

		const projects: Record<string, string | TodoistProjectSettings> = {};
		for (const [path, project] of Object.entries(projectRecord)) {
			const entry = parseProjectEntry(path, project);
			if (entry === null) continue;
			projects[entry[0]] = entry[1];
		}
		return { projects };
	} catch {
		return { projects: {} };
	}
}

export async function loadConfig(
	path = defaultConfigPath(),
): Promise<TodoistProjectMapping> {
	try {
		return parseConfig(await readFile(path, STRING_LITERAL_UTF8_D89108E9));
	} catch {
		return { projects: {} };
	}
}

export function resolveConfiguredProject(
	cwd: string,
	config: TodoistProjectMapping,
): ResolvedProject | null {
	const current = normalizedPath(cwd);
	const candidates = Object.entries(config.projects)
		.map(([codingRoot, project]) => ({
			codingRoot: normalizedPath(codingRoot),
			todoistProjectRef:
				typeof project === "string" ? project : project.todoistProjectRef,
			triggersOnlyOnWorktree:
				typeof project === "string"
					? true
					: project.triggersOnlyOnWorktree !== false,
		}))
		.filter(({ codingRoot }) => isPathAtOrBelow(current, codingRoot))
		.sort((a, b) => b.codingRoot.length - a.codingRoot.length);

	const match = candidates[0];
	return match ? match : null;
}

export function configPathForAgentDir(agentDir: string): string {
	return join(
		isAbsolute(agentDir) ? agentDir : resolve(agentDir),
		STRING_LITERAL_PI_TODO_GATE_JSON_67D8A0C1,
	);
}

export function parentDirectory(path: string): string {
	return dirname(normalizedPath(path));
}
