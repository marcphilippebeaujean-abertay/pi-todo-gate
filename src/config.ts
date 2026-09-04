const PI = ".pi";
const AGENT = "agent";
const PI_TODO_GATE_JSON = "pi-todo-gate.json";
const UTF8_ENCODING = "utf8";
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";

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
	const isObjectValue = typeof value === OBJECT_TYPE;
	const isNullValue = value === null;
	const isNotObject = !isObjectValue || isNullValue;
	if (isNotObject) return false;
	return !Array.isArray(value);
}

function addProject(
	projects: Record<string, string>,
	path: string,
	project: string,
): void {
	const normalizedPath = path.trim();
	const normalizedProject = project.trim();
	const hasValues = normalizedPath !== "" && normalizedProject !== "";
	if (hasValues) projects[normalizedPath] = normalizedProject;
}

export function parseConfig(raw: string): TodoistProjectMapping {
	try {
		const parsed: unknown = JSON.parse(raw);
		const isParsedRecord = isRecord(parsed);
		const parsedRecord = isParsedRecord ? parsed : null;
		if (parsedRecord === null) return { projects: {} };
		const isProjectRecord = isRecord(parsedRecord.projects);
		const projectRecord = isProjectRecord ? parsedRecord.projects : null;
		if (projectRecord === null) return { projects: {} };

		const projects: Record<string, string> = {};
		for (const [path, project] of Object.entries(
			projectRecord as Record<string, unknown>,
		)) {
			const projectIsString = typeof project === STRING_TYPE;
			if (!projectIsString) continue;
			addProject(projects, path, project as string);
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

function isPathAtOrBelow(path: string, ancestor: string): boolean {
	const target = resolve(path);
	const parent = resolve(ancestor);
	const hasTrailingSeparator = parent.endsWith("/") || parent.endsWith("\\");
	const prefix = hasTrailingSeparator ? parent : `${parent}/`;
	return target === parent || target.startsWith(prefix);
}

export function resolveConfiguredProject(
	cwd: string,
	config: TodoistProjectMapping,
): ResolvedProject | null {
	const current = resolve(cwd);
	let match: ResolvedProject | null = null;
	for (const [codingRoot, todoistProjectRef] of Object.entries(
		config.projects,
	)) {
		const normalizedRoot = resolve(codingRoot);
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
	const isAbsoluteAgentDir = isAbsolute(agentDir);
	const resolvedAgentDir = isAbsoluteAgentDir ? agentDir : resolve(agentDir);
	return join(resolvedAgentDir, PI_TODO_GATE_JSON);
}

export function parentDirectory(path: string): string {
	return dirname(resolve(path));
}
