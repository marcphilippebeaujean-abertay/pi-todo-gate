import { isRecord } from "../shared/records.ts";
import type { TodoistProjectSettings } from "./config.ts";

export type ProjectEntry = string | TodoistProjectSettings;

export function parseProjectEntry(
	path: string,
	project: unknown,
): [string, ProjectEntry] | null {
	const normalizedPath = path.trim();
	const hasPath = normalizedPath !== "";
	if (!hasPath) return null;
	if (typeof project === "string") {
		const normalizedProject = project.trim();
		const hasProject = normalizedProject !== "";
		if (!hasProject) return null;
		return [normalizedPath, normalizedProject];
	}
	const isObjectProject = isRecord(project);
	const objectProject = isObjectProject ? project : null;
	if (objectProject === null) return null;
	const projectRef = objectProject.todoistProjectRef;
	if (typeof projectRef !== "string") return null;
	const hasProjectRef = projectRef.trim() !== "";
	if (!hasProjectRef) return null;
	const hasTriggerSetting =
		typeof objectProject.triggersOnlyOnWorktree === "boolean";
	const triggerSetting = hasTriggerSetting
		? {
				triggersOnlyOnWorktree: objectProject.triggersOnlyOnWorktree as boolean,
			}
		: {};
	return [
		normalizedPath,
		{
			todoistProjectRef: projectRef.trim(),
			...triggerSetting,
		},
	];
}
