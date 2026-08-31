# Independent PR and Todoist Tracking Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `pi-todo-gate` into independent PR and Todoist tracking modules behind one Pi extension, with PR behavior available without Todoist configuration and merge reminders replacing automatic task completion.

**Architecture:** Keep `extensions/pi-todo-gate.ts` as a thin composition root. Move PR behavior into `src/pr/`, Todoist behavior into `src/todoist/`, and neutral command/session/project helpers into `src/shared/`; neither domain imports the other. Persist separate PR and Todoist custom state entries and register separate tools.

**Tech Stack:** TypeScript ES2022, Vitest, Biome, Pi extension APIs, `gh` CLI, `td` CLI.

**Spec:** `docs/superpowers/specs/2026-08-30-independent-pr-todoist-modules-design.md`

## Global Constraints

- One installed Pi extension remains the runtime entrypoint.
- PR tracking works in an unconfigured project.
- Todoist tracking exists only for configured projects.
- PR and Todoist modules have separate state, tools, lifecycle logic, and status rendering.
- Static architecture tests enforce no cross-domain imports.
- A merged PR clears the displayed PR and records its exact URL in merged history.
- A later distinct PR becomes the displayed active PR.
- Merge detection adds the exact reminder context and does not complete Todoist tasks.
- Do not enable tracking inside dispatched subagent sessions.
- Existing combined `pi-todo-gate-state` entries and `pi_todo_gate_state` behavior are intentionally not migrated.
- Exact merge reminder text: `Please ensure you have closed all completed tasks for this session if you have been using task tracking`
- Custom state types: `pi-pr-gate-state` and `pi-todoist-gate-state`.
- Public tools: `pi_pr_gate_state` and `pi_todoist_gate_state`.

---

## File Map

### Create

- `src/shared/command.ts` — `CommandResult`, `Exec`, and `spawnExec`.
- `src/shared/session-state.ts` — generic custom-entry state reading and writing.
- `src/shared/project.ts` — Git project-root, branch, and worktree inspection.
- `src/pr/state.ts` — `PrState`, `MergedPr`, validation, merge-history transitions.
- `src/pr/detection.ts` — GitHub PR URL parsing and discovery.
- `src/pr/git.ts` — PR lookup and strict merge-command matching.
- `src/pr/footer.ts` — PR-only status rendering.
- `src/pr/module.ts` — PR lifecycle, tool, state, and merge reminder behavior.
- `src/todoist/state.ts` — `TodoistState` and validation.
- `src/todoist/config.ts` — Todoist configuration loading and project resolution.
- `src/todoist/client.ts` — Todoist CLI client.
- `src/todoist/footer.ts` — Todoist-only status rendering.
- `src/todoist/module.ts` — Todoist lifecycle, tool, state, and context behavior.
- `test/architecture.test.ts` — source-import boundary tests.
- `test/pr/module.test.ts` — PR lifecycle and merge-reminder tests.
- `test/todoist/module.test.ts` — Todoist lifecycle and prompt tests.

### Modify

- `extensions/pi-todo-gate.ts` — replace coupled implementation with composition root.
- `test/extension.test.ts` — test one-extension composition and conditional Todoist activation.
- `test/session-state.test.ts` — test generic domain-keyed state helpers.
- `test/git.test.ts` — import shared/project and PR Git functions from new locations.
- `test/pr-detection.test.ts` — import PR detection from `src/pr/detection.ts` or move coverage into PR module tests.
- `test/todoist.test.ts` — import `src/todoist/client.ts` and remove completion expectations.
- `test/footer.test.ts` — import PR and Todoist renderers from their domain modules.

### Delete after imports are migrated

- `src/git.ts` — replaced by `src/shared/command.ts`, `src/shared/project.ts`, and `src/pr/git.ts`.
- `src/pr-detection.ts` — replaced by `src/pr/detection.ts`.
- `src/todoist.ts` — replaced by `src/todoist/client.ts`.
- `src/config.ts` — replaced by `src/todoist/config.ts`.
- `src/footer.ts` — replaced by domain-owned footer renderers.
- `src/session-state.ts` — replaced by `src/shared/session-state.ts`.
- `src/types.ts` — replaced by domain and shared types.

---

## Task 1: Extract neutral shared infrastructure

**Files:**
- Create: `src/shared/command.ts`
- Create: `src/shared/session-state.ts`
- Create: `src/shared/project.ts`
- Modify: `test/session-state.test.ts`
- Modify: `test/git.test.ts`

**Interfaces:**
- Produces `CommandResult`, `Exec`, and `spawnExec` for both domains.
- Produces `latestCustomState<T>(entries, customType, isState): T | null`.
- Produces `appendCustomState<T>(appendEntry, customType, state): void`.
- Produces `ProjectInfo` and `inspectProject(exec, cwd): Promise<ProjectInfo>`.

- [ ] **Step 1: Write failing generic state tests**

Add tests proving domain-keyed reads cannot cross-read entries:

```ts
it("reads only the requested custom state type", () => {
  const entries = [
    { type: "custom", customType: "pi-pr-gate-state", data: { prUrl: "pr" } },
    { type: "custom", customType: "pi-todoist-gate-state", data: { taskRef: "task" } },
  ];

  expect(
    latestCustomState(
      entries,
      "pi-pr-gate-state",
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    ),
  ).toEqual({
    prUrl: "pr",
  });
});
```

Add a test proving `appendCustomState` writes the requested custom type and payload unchanged.

- [ ] **Step 2: Run state tests and verify failure**

Run: `npx vitest run test/session-state.test.ts`

Expected: FAIL because generic helpers do not exist.

- [ ] **Step 3: Move command execution types and implementation**

Copy `CommandResult`, `Exec`, and `spawnExec` from `src/git.ts` into `src/shared/command.ts`. Preserve timeout, abort, shell-disabled spawning, stderr capture, and exit-code behavior exactly.

- [ ] **Step 4: Implement generic session-state helpers**

Implement validators and helpers without importing PR or Todoist types:

```ts
export function latestCustomState<T>(
  entries: readonly unknown[],
  customType: string,
  isState: (value: unknown) => value is T,
): T | null;

export function appendCustomState<T>(
  appendEntry: (customType: string, data: T) => void,
  customType: string,
  state: T,
): void;
```

`latestCustomState` scans newest to oldest, requires `type === "custom"`, matches `customType`, and returns only data accepted by `isState`.

- [ ] **Step 5: Move project inspection**

Move `inspectWorktree` and its Git parsing helper into `src/shared/project.ts` as `inspectProject`. Keep the returned shape:

```ts
export interface ProjectInfo {
  isWorktree: boolean;
  root: string | null;
  branch: string | null;
}
```

Keep the current inert result `{ isWorktree: false, root: null, branch: null }` when any Git lookup rejects.

- [ ] **Step 6: Update shared tests and imports**

Update `test/git.test.ts` to import `inspectProject` from `src/shared/project.ts` and command types from `src/shared/command.ts`. Keep existing assertions for linked worktrees, main checkout, and rejected Git lookups.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run test/session-state.test.ts test/git.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit shared extraction**

```bash
git add src/shared test/session-state.test.ts test/git.test.ts
git commit -m "refactor: extract shared tracking infrastructure"
```

## Task 2: Build PR domain state and pure utilities

**Files:**
- Create: `src/pr/state.ts`
- Create: `src/pr/detection.ts`
- Create: `src/pr/git.ts`
- Create: `src/pr/footer.ts`
- Modify: `test/pr-detection.test.ts`
- Modify: `test/git.test.ts`

**Interfaces:**
- Produces `PrState`, `MergedPr`, `isPrState`, and pure merge-history transitions.
- Produces `githubPrUrl`, `firstGithubPrUrl`, and `firstUnmergedGithubPrUrl` from `src/pr/detection.ts`.
- Produces existing `findPrState`, `findOpenPr`, `mergeCommand`, and `matchesPinnedPr` from `src/pr/git.ts`.
- Produces `renderPrStatus` from `src/pr/footer.ts`.

- [ ] **Step 1: Write failing PR state tests**

Create tests for exact per-PR mapping and active PR clearing:

```ts
it("records each merged PR and clears active PR", () => {
  const next = recordMergedPr(
    { prUrl: "https://github.com/o/r/pull/42" },
    "2026-08-30T00:00:00Z",
  );

  expect(next).toEqual({
    mergedPrs: [{
      prUrl: "https://github.com/o/r/pull/42",
      detectedAt: "2026-08-30T00:00:00Z",
      reminderPending: true,
    }],
  });
});

it("selects the next URL while excluding every merged URL", () => {
  expect(firstUnmergedGithubPrUrl([
    "https://github.com/o/r/pull/42 https://github.com/o/r/pull/43",
  ], ["https://github.com/o/r/pull/42"])).toBe(
    "https://github.com/o/r/pull/43",
  );
});
```

Add tests for appending a second merged record, consuming all pending reminders, preserving delivered records, and removing a URL on explicit reuse.

- [ ] **Step 2: Run PR state tests and verify failure**

Run: `npx vitest run test/pr/module.test.ts`

Expected: FAIL because the PR state module does not exist.

- [ ] **Step 3: Implement PR state transitions**

Define:

```ts
export const PR_STATE_TYPE = "pi-pr-gate-state";

export interface MergedPr {
  prUrl: string;
  detectedAt: string;
  reminderPending: boolean;
}

export interface PrState {
  prUrl?: string;
  mergedPrs?: MergedPr[];
  discoveryDisabled?: boolean;
}
```

Implement `isPrState`, `recordMergedPr`, `markRemindersDelivered`, `removeMergedPr`, and `mergedUrls`. `recordMergedPr` must delete active `prUrl`, append without duplicate URL records, and set `discoveryDisabled` to false.

- [ ] **Step 4: Move PR detection and Git logic**

Move current PR URL parsing into `src/pr/detection.ts`. Add `firstUnmergedGithubPrUrl(texts, mergedUrls)` that scans oldest-to-newest and returns the first valid URL not in the merged URL set.

Move PR-specific functions from `src/git.ts` into `src/pr/git.ts`; import `Exec` and `CommandResult` only from `src/shared/command.ts`. Preserve strict command parsing, repository validation, non-completing merge rejection, and `MERGED` plus non-empty `mergedAt` requirement.

- [ ] **Step 5: Move PR footer rendering**

Move `renderPrStatus` and its PR-only helpers into `src/pr/footer.ts`. The module must not import Todoist types or render Todoist text.

- [ ] **Step 6: Run PR utility tests**

Run: `npx vitest run test/pr-detection.test.ts test/git.test.ts test/pr/module.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit PR utilities**

```bash
git add src/pr test/pr-detection.test.ts test/git.test.ts test/pr/module.test.ts
git commit -m "refactor: isolate PR tracking domain"
```

## Task 3: Build Todoist domain state, client, config, and prompts

**Files:**
- Create: `src/todoist/state.ts`
- Create: `src/todoist/config.ts`
- Create: `src/todoist/client.ts`
- Create: `src/todoist/footer.ts`
- Create: `src/todoist/module.ts`
- Modify: `test/todoist.test.ts`
- Modify: `test/config.test.ts`
- Modify: `test/footer.test.ts`

**Interfaces:**
- Produces `TodoistState`, `isTodoistState`, and `TODOIST_STATE_TYPE`.
- Produces existing config functions from `src/todoist/config.ts`.
- Produces `TodoistClient`, `TodoistError`, `TodoistTask`, and `TodoistExec` from `src/todoist/client.ts`.
- Produces `renderTaskStatus` from `src/todoist/footer.ts`.
- Produces Todoist lifecycle methods and context generation from `src/todoist/module.ts`.

- [ ] **Step 1: Write failing prompt-mode tests**

Add tests for no task, current task, inherited task, and cleared task:

```ts
it("generates new-task context with configured project", () => {
  expect(todoistContext({}, "Merge TD")).toContain(
    "Find or create a Todoist task matching this work in the configured project.",
  );
  expect(todoistContext({}, "Merge TD")).toContain(
    "pi_todoist_gate_state using set_task",
  );
  expect(todoistContext({}, "Merge TD")).toContain("Merge TD");
});

it("generates continue context for an active task", () => {
  expect(todoistContext({ taskRef: "42", taskName: "Implement feature" }, "Merge TD"))
    .toContain("Continue working on and tracking this task in Todoist.");
});
```

Add tests proving no context is created when no configured project exists and that Todoist state validation ignores PR-shaped data.

- [ ] **Step 2: Run Todoist prompt tests and verify failure**

Run: `npx vitest run test/todoist/module.test.ts`

Expected: FAIL because the new module does not exist.

- [ ] **Step 3: Move Todoist client and config**

Move `TodoistClient`, parsing helpers, sanitization, errors, and `TodoistExec` into `src/todoist/client.ts`. Remove `completeTask` and its tests. Move config parsing/loading/resolution into `src/todoist/config.ts` without changing configured path behavior.

- [ ] **Step 4: Implement Todoist state and prompt functions**

Define:

```ts
export const TODOIST_STATE_TYPE = "pi-todoist-gate-state";

export interface TodoistState {
  taskRef?: string;
  taskName?: string;
  taskUrl?: string;
}

export function todoistContext(
  state: TodoistState,
  projectRef: string,
): string;
```

`todoistContext` returns active-task text when `taskRef` exists; otherwise returns the full find/create/assign workflow and includes `projectRef`. It must never include a hardcoded project ID.

- [ ] **Step 5: Move Todoist footer rendering**

Move `renderTaskStatus` and task-name display helpers into `src/todoist/footer.ts`. Keep URL validation and truncation behavior. Do not import PR footer or PR state.

- [ ] **Step 6: Implement Todoist lifecycle module**

Extract task inference, generation guards, config-gated startup, same-project inheritance, `set_task`, `clear_task`, status updates, and task-specific notifications from the extension. The module must expose narrow lifecycle methods used by the composition root and must never accept PR state or merge events.

`set_task` continues to resolve the configured project, validate project ownership, reject another task already in progress, and move the selected task to `In Progress`.

- [ ] **Step 7: Update Todoist and footer tests**

Replace combined-state expectations with `pi-todoist-gate-state`. Remove automatic-completion and retry assertions. Keep client tests for project resolution, malformed payloads, task ownership, section lookup, URL safety, and CLI error sanitization.

- [ ] **Step 8: Run Todoist tests**

Run: `npx vitest run test/todoist.test.ts test/todoist/module.test.ts test/config.test.ts test/footer.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Todoist domain**

```bash
git add src/todoist test/todoist.test.ts test/config.test.ts test/footer.test.ts
git commit -m "refactor: isolate Todoist tracking domain"
```

## Task 4: Replace extension with one composition root

**Files:**
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `test/extension.test.ts`
- Delete after migration: `src/git.ts`, `src/pr-detection.ts`, `src/todoist.ts`, `src/config.ts`, `src/footer.ts`, `src/session-state.ts`, `src/types.ts`

**Interfaces:**
- Consumes independent PR and Todoist module factories.
- Produces one extension that registers both tools only under their domain activation rules.
- Produces deterministic combined hidden context with PR reminder before Todoist context.

- [ ] **Step 1: Write failing extension activation tests**

Add an unconfigured-project test:

```ts
it("loads PR behavior without Todoist configuration", async () => {
  const h = harness("/unconfigured/project", [
    {
      type: "message",
      message: { role: "assistant", content: "https://github.com/o/r/pull/42" },
    },
  ]);

  await start(h, {});

  expect(h.tools.map((tool) => tool.name)).toEqual(["pi_pr_gate_state"]);
  expect(h.appended.at(-1)).toEqual({
    type: "pi-pr-gate-state",
    data: { prUrl: "https://github.com/o/r/pull/42" },
  });
});
```

Add a merge-reminder test proving active PR state is cleared, two merged records remain tied to their URLs, and the exact reminder is returned once on the next `before_agent_start`.

Add a configured-project test proving both tools are registered and no Todoist completion method is called after a merge.

- [ ] **Step 2: Run extension tests and verify failure**

Run: `npx vitest run test/extension.test.ts`

Expected: FAIL because the current extension still requires Todoist configuration and exposes one combined tool.

- [ ] **Step 3: Implement composition-root activation**

Keep the first operation as the existing `PI_SUBAGENT_CHILD === "1"` return. Register one set of Pi hooks. Always create/start the PR module. Resolve config and create/start Todoist only when the current path matches.

When a session changes from configured to unconfigured, deactivate only Todoist and retain PR behavior. When a session changes from unconfigured to configured, initialize Todoist from its own state entry.

- [ ] **Step 4: Forward lifecycle events independently**

For each Pi event, call PR and Todoist methods separately:

- `session_start`: PR first, then optional Todoist.
- `message_end`: PR URL discovery only.
- `before_agent_start`: collect PR context, then Todoist context if active.
- `tool_result`: send successful Bash data to PR merge detection and task-related data to Todoist inference independently.
- `session_shutdown`: deactivate both active modules.

Catch and notify domain-specific failures inside each module so one module cannot prevent the other from completing its hook work.

- [ ] **Step 5: Register separate tools and statuses**

Register `pi_pr_gate_state` with only `status`, `set_pr`, and `clear_pr`. Register `pi_todoist_gate_state` with only `status`, `set_task`, and `clear_task` when Todoist is active. Use existing independent status keys `pi-todo-gate-pr` and `pi-todo-gate-task`; each key is updated only by its owning module, and no shared status renderer is allowed.

- [ ] **Step 6: Implement merged-PR replacement flow**

On confirmed merge, call PR state transition with the exact active URL. Clear displayed PR immediately, append a `MergedPr` record, re-enable discovery, and exclude all `mergedPrs` URLs when scanning later output. On the next `before_agent_start`, emit the exact reminder and mark all pending records delivered.

Do not import Todoist state, client, or config into PR module code. Do not call any Todoist method from the merge path.

- [ ] **Step 7: Update extension integration tests**

Replace combined `pi-todo-gate-state` assertions with separate entries and tools. Add tests for current task context, inherited task context, new-task workflow context, clear-task reset, PR-only unconfigured operation, independent context composition, and subagent exclusion.

- [ ] **Step 8: Run extension tests**

Run: `npx vitest run test/extension.test.ts`

Expected: PASS.

- [ ] **Step 9: Remove obsolete coupled files and imports**

Delete the old coupled source files only after `rg -n "src/(git|pr-detection|todoist|config|footer|session-state|types)" extensions src test` returns no obsolete imports. Keep the extension as one file and the two domains as separate directories.

- [ ] **Step 10: Commit composition root**

```bash
git add extensions/pi-todo-gate.ts test/extension.test.ts
git rm src/git.ts src/pr-detection.ts src/todoist.ts src/config.ts src/footer.ts src/session-state.ts src/types.ts
git commit -m "refactor: compose independent tracking modules"
```

## Task 5: Add static architecture enforcement

**Files:**
- Create: `test/architecture.test.ts`

**Interfaces:**
- Consumes repository TypeScript source files.
- Produces failing tests for forbidden domain import directions.

- [ ] **Step 1: Write architecture assertions**

Implement a small import scanner using `node:fs`, `node:path`, and a regular expression for relative imports. Assert these rules:

```ts
expect(importsUnder("src/pr")).not.toContain("src/todoist/");
expect(importsUnder("src/todoist")).not.toContain("src/pr/");
expect(importsUnder("src/shared")).not.toContain("src/pr/");
expect(importsUnder("src/shared")).not.toContain("src/todoist/");
expect(importsOf("extensions/pi-todo-gate.ts")).toContain("src/pr/module.ts");
expect(importsOf("extensions/pi-todo-gate.ts")).toContain("src/todoist/module.ts");
```

Also scan `test/pr` and `test/todoist` so PR tests cannot import Todoist implementation and Todoist tests cannot import PR implementation.

- [ ] **Step 2: Run architecture test and verify it passes against intended layout**

Run: `npx vitest run test/architecture.test.ts`

Expected: PASS with no cross-domain imports.

- [ ] **Step 3: Add a deliberate boundary mutation check**

Temporarily add one forbidden import to a domain source, run the test, confirm failure, then revert the temporary line. Leave the test asserting the real boundary.

- [ ] **Step 4: Commit architecture enforcement**

```bash
git add test/architecture.test.ts
git commit -m "test: enforce tracking module boundaries"
```

## Task 6: Run complete verification and review diff

**Files:**
- No planned file changes; verification corrections may modify only source/test files from Tasks 1–5.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all Vitest tests pass, including PR-only activation, Todoist prompt modes, merge-history replacement, and architecture boundaries.

- [ ] **Step 2: Run TypeScript verification**

Run: `npm run typecheck`

Expected: `tsc --noEmit` exits 0 with no unresolved imports or incompatible Pi handler types.

- [ ] **Step 3: Run Biome verification**

Run: `npm run lint`

Expected: Biome reports no formatting, import, or correctness violations.

- [ ] **Step 4: Inspect final diff and state**

Run:

```bash
git diff origin/main...HEAD --stat
git diff --check origin/main...HEAD
git status --short
```

Expected: no whitespace errors, no accidental generated files, and only the approved source, test, and plan/spec changes. Leave any pre-existing Vim swap file untracked and untouched.

- [ ] **Step 5: Commit verification fixes**

If verification required source or test corrections, commit them with:

```bash
git add extensions src test
git commit -m "fix: complete independent tracking split"
```

## Completion Checklist

- [ ] One extension entrypoint remains.
- [ ] PR module starts with empty Todoist config.
- [ ] Todoist module starts only for configured projects.
- [ ] Separate tools and state entries exist.
- [ ] PR merge records exact merged URLs in a list.
- [ ] Active PR clears immediately after confirmed merge.
- [ ] Next distinct PR becomes active.
- [ ] Exact reminder appears once on next agent prompt.
- [ ] Todoist task completion and retry code are gone.
- [ ] Todoist prompt distinguishes active/inherited task from new-task workflow.
- [ ] ArchUnit-style boundary tests pass.
- [ ] `npm test`, `npm run typecheck`, and `npm run lint` pass.
