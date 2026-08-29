import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";
import { readPiTaskStore, sessionTaskPath } from "../src/pi-tasks-sync.ts";

function harness(cwd: string, branch: unknown[] = []) {
  const handlers = new Map<string, (event: any, ctx: any) => Promise<any> | any>();
  const tools: any[] = [];
  const appended: unknown[] = [];
  const notifications: string[] = [];
  const footerCalls: unknown[] = [];
  const pi: any = {
    on: (event: string, handler: any) => handlers.set(event, handler),
    registerTool: (tool: any) => tools.push(tool),
    appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
  };
  const ctx: any = {
    cwd,
    mode: "print",
    ui: {
      notify: (message: string) => notifications.push(message),
      setFooter: (factory: unknown) => footerCalls.push(factory),
    },
    sessionManager: {
      getBranch: () => branch,
      getSessionId: () => "session-current",
      getSessionFile: () => "/sessions/current.jsonl",
      getSessionDir: () => "/sessions",
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
  };
  return { pi, ctx, handlers, tools, appended, notifications, footerCalls };
}

const config = (projects: Record<string, string>) => ({ projects });

async function start(h: ReturnType<typeof harness>, projects: Record<string, string>) {
  extension(h.pi, {
    loadConfig: async () => config(projects),
  });
  await h.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, h.ctx);
}

describe("lazy activation", () => {
  it("does not register tools or perform external work for an unmatched project", async () => {
    const h = harness("/unconfigured/project");
    await start(h, { "/configured": "merge-td" });
    expect(h.tools).toHaveLength(0);
    expect(h.appended).toHaveLength(0);
  });

  it("registers the state tool only for a matched project", async () => {
    const h = harness("/configured/project");
    await start(h, { "/configured": "merge-td" });
    expect(h.tools.map((tool) => tool.name)).toEqual(["pi_todo_gate_state"]);
  });
});

describe("hidden lifecycle context", () => {
  it("warns on every prompt only when no task is active", async () => {
    const h = harness("/configured/project");
    await start(h, { "/configured": "merge-td" });
    const result = await h.handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "work" }, h.ctx);
    expect(result.message.content).toContain("you have no claimed a todoist task yet!");

    const withTask = harness("/configured/project", [
      { type: "custom", customType: "pi-todo-gate-state", data: { taskRef: "42", taskUrl: "https://app.todoist.com/app/task/42" } },
    ]);
    await start(withTask, { "/configured": "merge-td" });
    const second = await withTask.handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "work" }, withTask.ctx);
    expect(second).toBeUndefined();
  });

  it("discovers the first PR URL and ignores later URLs", async () => {
    const h = harness("/configured/project", [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "https://github.com/o/r/pull/1" }] } },
    ]);
    await start(h, { "/configured": "merge-td" });
    await h.handlers.get("message_end")?.({ type: "message_end", message: { role: "assistant", content: "https://github.com/o/r/pull/2" } }, h.ctx);
    expect(h.appended).toEqual([{ type: "pi-todo-gate-state", data: { prUrl: "https://github.com/o/r/pull/1" } }]);
    await h.handlers.get("message_end")?.({ type: "message_end", message: { role: "assistant", content: "https://github.com/o/r/pull/3" } }, h.ctx);
    expect(h.appended).toHaveLength(1);
  });

  it("never sends synchronization messages to the agent", async () => {
    const h = harness("/configured/project");
    let sent = 0;
    h.pi.sendMessage = () => { sent += 1; };
    h.pi.sendUserMessage = () => { sent += 1; };
    await start(h, { "/configured": "merge-td" });
    expect(sent).toBe(0);
  });
});

describe("pi_todo_gate_state", () => {
  it("validates and persists an explicit PR override", async () => {
    const h = harness("/configured/project");
    await start(h, { "/configured": "merge-td" });
    const result = await h.tools[0].execute("call", { action: "set_pr", url: "https://github.com/o/r/pull/42?tab=files" }, undefined, undefined, h.ctx);
    expect(h.appended.at(-1)).toEqual({ type: "pi-todo-gate-state", data: { prUrl: "https://github.com/o/r/pull/42" } });
    expect(result.content[0].text).toContain("42");
  });

  it("switches tasks only after loading the new parent's subtasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
    const h = harness(root, [
      { type: "custom", customType: "pi-todo-gate-state", data: { taskRef: "old", taskUrl: "https://app.todoist.com/app/task/old" } },
    ]);
    const calls: string[] = [];
    const client: any = {
      resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
      claimTask: async (ref: string) => ({ id: ref, webUrl: `https://app.todoist.com/app/task/${ref}`, projectId: "project-1" }),
      listDescendants: async (ref: string) => { calls.push(`list:${ref}`); return [{ id: "new-child", content: "[ ] New child", description: "", projectId: "project-1" }]; },
    };
    extension(h.pi, {
      loadConfig: async () => config({ [root]: "merge-td" }),
      createTodoistClient: () => client,
    });
    await h.handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, h.ctx);
    calls.length = 0;
    await h.tools[0].execute("call", { action: "set_task", task: "new-parent" }, undefined, undefined, h.ctx);
    expect(calls).toEqual(["list:new-parent"]);
    expect(h.appended.at(-1)).toEqual({ type: "pi-todo-gate-state", data: {
      taskRef: "new-parent",
      taskUrl: "https://app.todoist.com/app/task/new-parent",
    } });
    await expect(readPiTaskStore(sessionTaskPath(root, "session-current"))).resolves.toMatchObject({
      tasks: [{ subject: "New child" }],
    });
  });

  it("rejects invalid PR URLs without persisting them", async () => {
    const h = harness("/configured/project");
    await start(h, { "/configured": "merge-td" });
    await expect(h.tools[0].execute("call", { action: "set_pr", url: "https://example.com/pr/42" }, undefined, undefined, h.ctx)).rejects.toThrow();
    expect(h.appended).toHaveLength(0);
  });
});

