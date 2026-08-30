import type { CommandResult } from "./git.ts";

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	projectId: string;
	sectionId?: string | null;
	sectionName?: string | null;
	parentId?: string | null;
	url?: string;
	webUrl?: string;
}

export interface TodoistChild extends TodoistTask {
	children?: TodoistChild[];
}

export interface TodoistExec {
	run(args: readonly string[]): Promise<CommandResult>;
}

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		super(`Todoist ${commandFamily} failed${detail ? `: ${detail}` : ""}`);
		this.name = "TodoistError";
		this.commandFamily = commandFamily;
	}
}

function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			"$1=[redacted]",
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(family, "invalid JSON response");
	}
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TodoistError("response", "unexpected JSON shape");
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function nullableString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" ? value : undefined;
}

function taskFromPayload(value: unknown): TodoistTask {
	const data = record(value);
	const id = stringValue(data.id);
	const content = stringValue(data.content);
	const projectId = stringValue(data.projectId ?? data.project_id);
	if (!id || !content || !projectId)
		throw new TodoistError("response", "task has missing required fields");
	return {
		id,
		content,
		description: stringValue(data.description),
		projectId,
		sectionId: nullableString(data.sectionId ?? data.section_id),
		sectionName: nullableString(data.sectionName ?? data.section_name),
		parentId: nullableString(data.parentId ?? data.parent_id),
		url: safeHttpUrl(data.url),
		webUrl: safeHttpUrl(data.webUrl ?? data.web_url),
	};
}

function childList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const data = record(value);
	if (Array.isArray(data.tasks)) return data.tasks;
	if (Array.isArray(data.results)) return data.results;
	throw new TodoistError("response", "expected a list payload");
}

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
	): Promise<unknown> {
		const result = await this.exec.run(args);
		if (result.code !== 0) {
			const family = args.slice(0, 2).join(" ");
			throw new TodoistError(family, sanitizeError(result.stderr));
		}
		return parseJson
			? parsePayload(result.stdout, args.slice(0, 2).join(" "))
			: result.stdout;
	}

	async resolveProject(ref: string): Promise<{ id: string; name: string }> {
		const payload = await this.run(["project", "list", "--json"]);
		const rows = childList(payload).map(record);
		const target = ref.startsWith("id:") ? ref.slice(3) : ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		if (!match)
			throw new TodoistError(
				"project list",
				`configured project not found: ${target}`,
			);
		return { id: stringValue(match.id), name: stringValue(match.name) };
	}

	async getTask(ref: string): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run(["task", "view", ref, "--json"]),
		);
		if (!task.url && !task.webUrl)
			task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	async claimTask(
		ref: string,
		project: { id: string; currentTaskId?: string },
	): Promise<TodoistTask> {
		const task = await this.getTask(ref);
		if (task.projectId !== project.id) {
			throw new TodoistError(
				"task claim",
				"task is outside the configured project",
			);
		}
		let sectionName = task.sectionName;
		if (!sectionName && task.sectionId) {
			const sections = await this.run([
				"section",
				"list",
				"--project",
				`id:${project.id}`,
				"--json",
			]);
			const section = childList(sections)
				.map(record)
				.find((item) => stringValue(item.id) === task.sectionId);
			sectionName = section ? stringValue(section.name) || null : null;
		}
		const isInProgress = sectionName?.trim().toLowerCase() === "in progress";
		if (isInProgress && task.id !== project.currentTaskId) {
			throw new TodoistError("task claim", "task is already in progress");
		}
		if (sectionName !== "In Progress") {
			await this.run(
				[
					"task",
					"move",
					ref,
					"--section",
					"In Progress",
					"--project",
					`id:${project.id}`,
				],
				false,
			);
			sectionName = "In Progress";
		}
		return {
			...task,
			sectionName,
			url:
				task.webUrl ??
				task.url ??
				`https://app.todoist.com/app/task/${task.id}`,
		};
	}

	async completeTask(ref: string): Promise<void> {
		await this.run(["task", "complete", ref], false);
	}

	async listDescendants(ref: string): Promise<TodoistChild[]> {
		const payload = await this.run(["task", "list", "--parent", ref, "--json"]);
		const children: TodoistChild[] = [];
		for (const item of childList(payload)) {
			const child = taskFromPayload(item) as TodoistChild;
			child.children = await this.listDescendants(child.id);
			children.push(child);
		}
		return children;
	}

	async deleteDescendants(
		children: readonly TodoistChild[],
		isCurrent?: () => boolean,
	): Promise<void> {
		for (const child of children) {
			if (isCurrent && !isCurrent()) return;
			if (child.children?.length)
				await this.deleteDescendants(child.children, isCurrent);
			if (isCurrent && !isCurrent()) return;
			await this.run(["task", "delete", `id:${child.id}`, "--yes"]);
		}
	}

	async createSubtask(
		parentRef: string,
		input: { content: string; description: string },
	): Promise<TodoistTask> {
		return taskFromPayload(
			await this.run([
				"task",
				"add",
				input.content,
				"--parent",
				parentRef,
				"--description",
				input.description,
				"--json",
			]),
		);
	}
}
