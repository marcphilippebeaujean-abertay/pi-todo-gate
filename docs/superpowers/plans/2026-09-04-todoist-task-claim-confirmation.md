# Todoist Task Claim Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic Todoist task mutation with a read-only worker proposal and explicit user-confirmed claim/create flow.

**Architecture:** `src/todoist/client.ts` becomes the single `td` transport/client boundary. An isolated worker returns one validated proposal envelope; an extension-owned flow presents it, performs the confirmed mutation, and persists session state. The existing Pi state tool loses all task actions while PR tracking remains available.

**Tech Stack:** TypeScript ES2022, Vitest, Biome, TypeBox, Pi extension APIs, Todoist `td` CLI.

**Spec:** `docs/superpowers/specs/2026-09-04-todoist-task-claim-confirmation-design.md`

## Global Constraints

- Worker output uses exactly `{ action: "error" | "claim" | "create"; taskData: { title: string; description: string; id: string | null } | null; error: string | null }`.
- `claim` requires existing task ID and null error; `create` requires null ID and null error; `error` requires null task data and non-empty error.
- Worker uses `td` for inspection only and never creates, moves, completes, clears, or claims tasks.
- User confirmation is required before every claim or create mutation.
- Any non-completed task may be claimed, including tasks already in `In Progress`.
- Remove `set_task` and `clear_task`; `clear_all` clears PR state only.
- Todoist failures do not disable PR behavior; stale asynchronous results cannot mutate state.
- Preserve merged-PR Todoist completion behavior.
- Treat CLI output and worker output as untrusted; sanitize credentials and bound diagnostics.
- Required final checks: `npm test`, `npm run typecheck`, `npm run lint`, `git diff --check`.

---

## File Map

### Modify

- `src/todoist/client.ts` — canonical Todoist client; add task creation and remove collision ownership logic.
- `src/todoist/claim-worker.ts` — exact stable proposal schema and read-only worker instructions.
- `src/todoist/claim-result.ts` — strict proposal parser.
- `src/todoist/parsing.ts` — preserve task title/description/ID parsing needed by proposals and creation.
- `src/extension-types.ts` — canonical Todoist client imports and claim-flow generation state.
- `src/extension-lifecycle.ts` — canonical client factory and task-state persistence helpers.
- `src/extension-session.ts` — initialize claim-flow state.
- `src/extension-events.ts` — trigger claim analysis without automatic session-history mutation.
- `src/extension-tool.ts` — remove task actions and task mutation branches from state tool schema/execution.
- `src/task-operations.ts` — remove obsolete agent-facing task actions; retain only helpers needed by confirmed flow or delete file if unused.
- `src/task-completion.ts` — use canonical client and preserve merged-task completion.
- `extensions/pi-todo-gate.ts` — wire claim flow dependency without exposing task commands.
- `test/todoist/claim-worker.test.ts` — proposal prompt, parser integration, and failure cases.
- `test/todoist/merge-prompt.test.ts` — canonical client creation and claim behavior.
- `test/todoist/module.test.ts` — remove task-tool expectations and retain state validation.
- `test/extension.test.ts` — confirmation flow, stale protection, removed actions, and merge completion.
- `test/todoist.test.ts` — move client tests to canonical module or remove duplicate test file after migration.
- `test/architecture.test.ts` — enforce canonical Todoist domain boundaries if needed.

### Create or retain

- `src/task-claiming-flow.ts` — worker orchestration, proposal UI, confirmed mutation, retry/leave-unassigned handling.
- `src/task-claiming.ts` — one-at-a-time claim analysis trigger and typed context.
- `src/todoist/client.ts` — existing modular file retained as canonical client.

### Delete after imports migrate

- `src/todoist.ts` — duplicate active client.
- `src/extension-tasks.ts` — obsolete automatic history/text inference that mutates Todoist without confirmation, unless reduced to pure non-mutating helpers used by the claim flow.

---

## Execution status

- [x] Canonical client, strict worker contract, confirmation flow, PR-only state tool, and module cleanup implemented.
- [x] Focused and full verification completed: 129 passed, 8 skipped; typecheck, lint, and diff check pass.

## Task 1: Establish canonical Todoist client

**Files:**
- Modify: `src/todoist/client.ts`
- Modify: `src/extension-lifecycle.ts`
- Modify: `src/extension-types.ts`
- Modify: `src/task-completion.ts`
- Modify: `src/task-operations.ts`
- Modify: `test/todoist/merge-prompt.test.ts`
- Modify: `test/todoist.test.ts`
- Delete: `src/todoist.ts` after all imports migrate

**Interfaces:**

```ts
export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId?: string | null;
  sectionName?: string | null;
  url?: string;
  webUrl?: string;
}

export class TodoistClient {
  resolveProject(ref: string): Promise<{ id: string; name: string }>;
  getTask(ref: string): Promise<TodoistTask>;
  claimTask(ref: string, project: { id: string }): Promise<TodoistTask>;
  createTask(title: string, description: string, project: { id: string }): Promise<TodoistTask>;
  completeTask(ref: string): Promise<void>;
}
```

- [ ] **Step 1: Add failing canonical-client tests**

Add tests proving `src/todoist/client.ts` claims a task whose section is already `In Progress` and creates a task with `--description`, configured project, `In Progress` section, and JSON output.

```ts
it("claims an already In Progress task without collision", async () => {
  const client = new TodoistClient(fakeTodoist({
    "task view 42 --json": ok(task({ sectionName: "In Progress" })),
  }).exec);

  await expect(client.claimTask("42", { id: "project-1" }))
    .resolves.toMatchObject({ id: "42" });
});
```

```ts
it("creates task with proposed description", async () => {
  const fake = fakeTodoist({
    "task add Implement feature --description Useful details --project id:project-1 --section In Progress --json":
      ok(task({ id: "43", content: "Implement feature", description: "Useful details" })),
  });

  await expect(client.createTask("Implement feature", "Useful details", { id: "project-1" }))
    .resolves.toMatchObject({ id: "43", description: "Useful details" });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/todoist/merge-prompt.test.ts test/todoist.test.ts`

Expected: failure because canonical client lacks the final creation contract and existing tests still target duplicate behavior.

- [ ] **Step 3: Move active client callers**

Change imports and dependency types from `../src/todoist.ts` or `./todoist.ts` to `../src/todoist/client.ts` or `./todoist/client.ts`. Adapt injected executors to the shared `Exec`/`TodoistExec` shape without adding UI or session dependencies to the client.

- [ ] **Step 4: Implement canonical claim and create methods**

Remove collision checks and `currentTaskId`/`allowInProgress` ownership semantics. Keep project membership validation. Move a task only when its resolved section is not `In Progress`. Implement creation with separate arguments:

```ts
[
  "task", "add", title,
  "--description", description,
  "--project", `id:${project.id}`,
  "--section", "In Progress",
  "--json",
]
```

Do not omit a proposed description merely because it is empty; worker-created proposals must provide one. Return parsed canonical task data.

- [ ] **Step 5: Delete duplicate flat client**

After `rg 'todoist\.ts|src/todoist\.ts' src extensions test` shows no production import, delete `src/todoist.ts` and update direct tests.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run test/todoist/merge-prompt.test.ts test/todoist.test.ts`

Expected: PASS.

---

## Task 2: Replace worker output with stable proposal envelope

**Files:**
- Modify: `src/todoist/claim-worker.ts`
- Modify: `src/todoist/claim-result.ts`
- Modify: `test/todoist/claim-worker.test.ts`

**Interfaces:**

```ts
export type TaskClaimWorkerResult = {
  action: "error" | "claim" | "create";
  taskData: {
    title: string;
    description: string;
    id: string | null;
  } | null;
  error: string | null;
};
```

- [ ] **Step 1: Write failing parser tests**

Test exact envelopes:

```ts
expect(parseResult(message('{"action":"claim","taskData":{"title":"Existing","description":"Details","id":"42"},"error":null}'))).toEqual({
  action: "claim",
  taskData: { title: "Existing", description: "Details", id: "42" },
  error: null,
});
expect(parseResult(message('{"action":"create","taskData":{"title":"New","description":"Proposed","id":null},"error":null}'))).toEqual({
  action: "create",
  taskData: { title: "New", description: "Proposed", id: null },
  error: null,
});
expect(parseResult(message('{"action":"error","taskData":null,"error":"Todoist unavailable"}'))).toEqual({
  action: "error",
  taskData: null,
  error: "Todoist unavailable",
});
```

Add malformed-shape tests: claim without ID, create with ID, error with task data, missing error, and legacy `claimed`/`collision`/`none` output. Each must yield a safe error result rather than a mutation-capable result.

- [ ] **Step 2: Run parser tests and verify failure**

Run: `npx vitest run test/todoist/claim-worker.test.ts`

Expected: FAIL against old status-based result parsing.

- [ ] **Step 3: Define TypeBox schema and parser**

Use one object schema with nullable fields and validate action-specific invariants after structural validation. Scan latest assistant output, extract one JSON object, and return `{ action: "error", taskData: null, error: "Invalid claim worker result." }` for malformed output. Do not retain legacy result compatibility.

- [ ] **Step 4: Rewrite worker instructions**

Require `td` inspection only. Explicitly state:

- Ignore `In Progress` as an ownership collision.
- Consider only non-completed tasks.
- Return `claim` with existing title, description, and ID.
- Return `create` with concise title, useful description, and `id: null`.
- Return `error` for technical or decision failures.
- Never create, move, claim, complete, or otherwise mutate Todoist.
- Output exactly the stable envelope and no explanation.

- [ ] **Step 5: Run worker tests**

Run: `npx vitest run test/todoist/claim-worker.test.ts`

Expected: PASS.

---

## Task 3: Implement confirmed claim flow

**Files:**
- Modify: `src/task-claiming-flow.ts`
- Modify: `src/task-claiming.ts`
- Modify: `src/extension-types.ts`
- Modify: `src/extension-session.ts`
- Modify: `src/extension-events.ts`
- Modify: `extensions/pi-todo-gate.ts`
- Test: `test/extension.test.ts`

**Interfaces:**

```ts
export interface ActiveSession {
  taskClaimAnalysisStarted: boolean;
  taskClaimGeneration: number;
}

export function maybeAnalyzeTaskClaim(
  runtime: ExtensionRuntime,
  session: ActiveSession,
  prompt: string,
): void;

export function runTaskClaim(
  runtime: ExtensionRuntime,
  session: ActiveSession,
  prompt: string,
  generation: number,
): Promise<void>;
```

- [ ] **Step 1: Add failing extension tests**

Add harness UI methods for `confirm` and `select`. Test:

1. Worker returns `claim`; confirmation message contains `claim existing`, title, description; confirming calls `claimTask`, persists task state, and updates footer.
2. Worker returns `create`; confirmation contains `new task`; confirming calls `createTask` with title/description and persists returned task.
3. Declining either proposal makes no client mutation and leaves state empty.
4. Worker returns `error`; selecting retry starts one fresh worker; selecting leave-unassigned makes no Todoist mutation.
5. A stale worker result, stale confirmation, or shutdown result cannot mutate state.
6. Worker starts only once while task is absent and never for unconfigured projects.

- [ ] **Step 2: Run new tests and verify failure**

Run: `npx vitest run test/extension.test.ts`

Expected: FAIL because production flow is incomplete or still performs automatic linking.

- [ ] **Step 3: Remove automatic claim paths**

Stop `handleSessionStart`, `handleBeforeAgentStart`, and `handleToolResult` from calling any history/text inference that mutates Todoist. Remove `src/extension-tasks.ts` once no callers remain. Claim analysis must be the only path that proposes and claims a task.

- [ ] **Step 4: Implement proposal presentation**

For claim/create, use extension UI confirmation. Display action type, title, and description. Decline returns without mutation. For error, use selection with exactly `Retry task claiming` and `Leave task unassigned`; retry increments generation and starts a new worker.

- [ ] **Step 5: Implement confirmed application**

After confirmation and current-generation validation, resolve project and invoke only `claimTask` or `createTask`. Persist state only after client success, then refresh footer and notify success. Catch confirmation-time errors without partial state writes.

- [ ] **Step 6: Run focused extension tests**

Run: `npx vitest run test/extension.test.ts`

Expected: PASS for new claim-flow coverage and existing PR/merge coverage.

---

## Task 4: Remove Todoist task actions from Pi state tool

**Files:**
- Modify: `src/constants.ts`
- Modify: `src/extension-tool.ts`
- Modify: `src/task-operations.ts`
- Modify: `src/extension-types.ts`
- Modify: `test/extension.test.ts`
- Modify: `test/todoist/module.test.ts`

**Interfaces:**

```ts
const StateActions = ["status", "set_pr", "clear_pr", "clear_all"] as const;
```

- [ ] **Step 1: Add failing schema/action tests**

Assert registered state schema accepts only `status`, `set_pr`, `clear_pr`, and `clear_all`. Assert `set_task` and `clear_task` are rejected or absent. Assert `clear_all` clears PR state but never calls Todoist or deletes task state.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/extension.test.ts test/todoist/module.test.ts`

Expected: FAIL while old task actions remain registered.

- [ ] **Step 3: Remove task actions and dead task-operation code**

Delete task action constants and branches from the public state tool. Remove `setTaskAction`, `clearTaskAction`, and task-specific operation invalidation when no internal caller remains. Keep internal confirmed claim persistence separate from public tool execution. Make `clear_all` PR-only.

- [ ] **Step 4: Update prompts and state-tool descriptions**

Ensure tool description and prompt no longer advertise Todoist task commands. Preserve PR status/set/clear behavior and existing task footer state produced by confirmed claim flow.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/extension.test.ts test/todoist/module.test.ts`

Expected: PASS.

---

## Task 5: Reconcile module boundaries and full regression suite

**Files:**
- Modify: `test/architecture.test.ts`
- Modify: affected source/tests from Tasks 1–4
- Delete: obsolete duplicate or inference files confirmed unused

- [ ] **Step 1: Run architecture and all tests**

Run: `npm test`

Expected: PASS. Fix only behavior or import failures caused by this feature; do not restore removed task actions or legacy worker statuses.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS with no stale `TodoistClient`, task-action, or result-union references.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS, including complexity and strict TypeScript checks in proposal parser and flow.

- [ ] **Step 4: Run diff validation**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: Review final diff**

Run: `git status --short && git diff --stat && git diff -- src/todoist/client.ts src/todoist/claim-worker.ts src/todoist/claim-result.ts src/extension-tool.ts src/task-claiming-flow.ts`

Confirm no unrelated edits, no credentials, no worker mutation commands, and no public Todoist task actions.

- [ ] **Step 6: Commit implementation**

```bash
git add src extensions test docs/superpowers/plans/2026-09-04-todoist-task-claim-confirmation.md
git commit -m "feat: gate Todoist task claims on user confirmation"
```
