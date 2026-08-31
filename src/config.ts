const PI = ".pi";
const AGENT = "agent";
const PI_TODO_GATE_JSON = "pi-todo-gate.json";
const UTF8_ENCODING = "utf8";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ResolvedProject, TodoistProjectMapping } from "./types.ts";

export function defaultConfigPath(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), PI, AGENT);
	return join(agentDir, PI_TODO_GATE_JSON);
}

export const DEFAULT_CONFIG_PATH = defaultConfigPath();

function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	return !Array.isArray(value);
}

export function parseConfig(raw: string): TodoistProjectMapping {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return { projects: {} };
		if (!isRecord(parsed.projects)) return { projects: {} };

		const projects: Record<string, string> = {};
		for (const [path, project] of Object.entries(parsed.projects)) {
			if (typeof path !== "string" || typeof project !== "string") continue;
			const normalizedPath = path.trim();
			const normalizedProject = project.trim();
			if (normalizedPath && normalizedProject) {
				projects[normalizedPath] = normalizedProject;
			}
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
		return parseConfig(await readFile(path, UTF8_ENCODING));
	} catch {
		return { projects: {} };
	}
}

function normalizedPath(path: string): string {
	return resolve(path);
}

function isPathAtOrBelow(path: string, ancestor: string): boolean {
	const target = normalizedPath(path);
	const parent = normalizedPath(ancestor);
	const prefix =
		parent.endsWith("/") || parent.endsWith("\\") ? parent : `${parent}/`;
	return target === parent || target.startsWith(prefix);
}

export function resolveConfiguredProject(
	cwd: string,
	config: TodoistProjectMapping,
): ResolvedProject | null {
	const current = normalizedPath(cwd);
	let match: ResolvedProject | null = null;
	for (const [codingRoot, todoistProjectRef] of Object.entries(
		config.projects,
	)) {
		const normalizedRoot = normalizedPath(codingRoot);
		const isWithinConfiguredRoot = isPathAtOrBelow(current, normalizedRoot);
		if (!isWithinConfiguredRoot) continue;
		const isMoreSpecific =
			match === null || normalizedRoot.length > match.codingRoot.length;
		if (isMoreSpecific)
			match = { codingRoot: normalizedRoot, todoistProjectRef };
	}
	return match;
}

export function configPathForAgentDir(agentDir: string): string {
	return join(
		isAbsolute(agentDir) ? agentDir : resolve(agentDir),
		PI_TODO_GATE_JSON,
	);
}

export function parentDirectory(path: string): string {
	return dirname(normalizedPath(path));
}
