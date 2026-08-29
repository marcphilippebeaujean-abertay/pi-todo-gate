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
    .replace(/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function taskFromPayload(value: unknown): TodoistTask {
  const data = record(value);
  const id = stringValue(data.id);
  if (!id) throw new TodoistError("response", "task has no id");
  return {
    id,
    content: stringValue(data.content),
    description: stringValue(data.description),
    projectId: stringValue(data.projectId ?? data.project_id),
    sectionId: nullableString(data.sectionId ?? data.section_id),
    sectionName: nullableString(data.sectionName ?? data.section_name),
    parentId: nullableString(data.parentId ?? data.parent_id),
    url: stringValue(data.url) || undefined,
    webUrl: stringValue(data.webUrl ?? data.web_url) || undefined,
  };
}

function childList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const data = record(value);
  return Array.isArray(data.tasks) ? data.tasks : [];
}

export class TodoistClient {
  constructor(private readonly exec: TodoistExec) {}

  private async run(args: readonly string[]): Promise<unknown> {
    const result = await this.exec.run(args);
    if (result.code !== 0) {
      const family = args.slice(0, 2).join(" ");
      throw new TodoistError(family, sanitizeError(result.stderr));
    }
    return parsePayload(result.stdout, args.slice(0, 2).join(" "));
  }

  async resolveProject(ref: string): Promise<{ id: string; name: string }> {
    const payload = await this.run(["project", "list", "--json"]);
    const rows = childList(payload).map(record);
    const target = ref.startsWith("id:") ? ref.slice(3) : ref;
    const match = rows.find((row) => stringValue(row.id) === target || stringValue(row.name) === target);
    if (!match) throw new TodoistError("project list", `configured project not found: ${target}`);
    return { id: stringValue(match.id), name: stringValue(match.name) };
  }

  async getTask(ref: string): Promise<TodoistTask> {
    const task = taskFromPayload(await this.run(["task", "view", ref, "--json"]));
    if (!task.url && !task.webUrl) task.url = `https://app.todoist.com/app/task/${task.id}`;
    return task;
  }

  async claimTask(ref: string, project: { id: string; currentTaskId?: string }): Promise<TodoistTask> {
    const task = await this.getTask(ref);
    if (task.projectId !== project.id) {
      throw new TodoistError("task claim", "task is outside the configured project");
    }
    let sectionName = task.sectionName;
    if (!sectionName && task.sectionId) {
      const section = record(await this.run(["section", "view", task.sectionId, "--json"]));
      sectionName = stringValue(section.name) || null;
    }
    if (sectionName === "In Progress" && task.id !== project.currentTaskId) {
      throw new TodoistError("task claim", "task is already in progress");
    }
    if (sectionName !== "In Progress") {
      await this.run(["task", "move", ref, "--section", "In Progress", "--project", `id:${project.id}`]);
      sectionName = "In Progress";
    }
    return {
      ...task,
      sectionName,
      url: task.webUrl ?? task.url ?? `https://app.todoist.com/app/task/${task.id}`,
    };
  }

  async completeTask(ref: string): Promise<void> {
    await this.run(["task", "complete", ref]);
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

  async deleteDescendants(children: readonly TodoistChild[]): Promise<void> {
    for (const child of children) {
      if (child.children?.length) await this.deleteDescendants(child.children);
      await this.run(["task", "delete", `id:${child.id}`, "--yes"]);
    }
  }

  async createSubtask(parentRef: string, input: { content: string; description: string }): Promise<TodoistTask> {
    return taskFromPayload(await this.run([
      "task",
      "add",
      input.content,
      "--parent",
      parentRef,
      "--description",
      input.description,
      "--json",
    ]));
  }
}
