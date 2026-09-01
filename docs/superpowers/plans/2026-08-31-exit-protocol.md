# Exit Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add event-driven merge/exit handling that completes active Todoist tasks and safely removes linked local worktrees through one combined, preselected action prompt.

**Architecture:** A typed async event bus separates PR, Todoist, worktree, and exit-protocol modules. PR publishes `prMerged`; Todoist and worktree modules contribute actions; exit-protocol presents and executes the selected actions. Worktree deletion is deferred until `sessionWillClose`, with automatic no-work deletion at quit.

**Tech Stack:** TypeScript, Pi Extension API, `@earendil-works/pi-tui` custom components, Vitest, Biome, Git CLI, Todoist CLI client.

**Spec:** `docs/superpowers/specs/2026-08-31-exit-protocol-design.md`

## Global Constraints

- Modules communicate through shared typed events, never direct module references.
- Keep merge detection in standalone `src/shared/merge-detection.ts`; it parses and validates merge commands without owning PR state or downstream behavior.
- All applicable actions start selected and focus starts on `Submit`.
- Worktree cleanup is deferred until `sessionWillClose`; `process.chdir(projectRoot)` does not update Pi's captured `ctx.cwd`.
- Delete only local worktrees and local branches; never delete remote branches.
- Dirty worktree removal requires explicit confirmation.
- No-work detection is valid only when initial/current status are empty and initial/current `HEAD` SHAs match.
- Non-quit shutdown reasons never perform destructive cleanup or task completion.
- JSON/print modes with `hasUI === false` skip prompts and destructive actions.
- Failed actions retain state and remain eligible for a later close event.
- Run `npm test`, `npm run typecheck`, and `npm run lint` before completion.

---

## File map

Create:

- `src/shared/events.ts` — typed event bus, event payloads, action collector, listener phases.
- `src/exit-protocol/types.ts` — stable action IDs/results and picker result types.
- `src/exit-protocol/picker.ts` — pure selection state plus TUI/RPC picker adapters.
- `src/exit-protocol/module.ts` — event-driven presenter and selected-action executor.
- `src/worktree/module.ts` — worktree baseline capture, no-work detection, deferred cleanup.
- `test/events.test.ts` — event ordering, action collection, failure isolation.
- `test/exit-protocol.test.ts` — picker defaults, action execution, retry behavior, lifecycle.
- `test/worktree.test.ts` — baseline comparison, cleanup commands, dirty confirmation.

Modify:

- `src/shared/project.ts` — expose main checkout root in `ProjectInfo` for worktree cleanup.
- `src/todoist/module.ts` — subscribe to shared events and contribute task-completion actions; remove direct merge prompt API.
- `src/pr/module.ts` — publish `prMerged` after PR state recording while continuing to use standalone merge detection.
- `extensions/pi-todo-gate.ts` — create bus/modules, initialize active modules before PR merge checks, emit `sessionWillClose`, deactivate after dispatch.
- `test/git.test.ts` — update `ProjectInfo` expectations for main root.
- `test/extension.test.ts` — replace direct PR→Todoist forwarding assertions with event-driven lifecycle assertions.
- `test/todoist.test.ts` and related Todoist tests — cover event-provided completion action behavior.

No changes needed to `src/shared/merge-detection.ts` unless implementation exposes a naming/type adjustment required by existing tests; its parsing and validation remain standalone.

---

### Task 1: Add typed shared event bus

**Files:**

- Create: `src/shared/events.ts`
- Create: `src/exit-protocol/types.ts`
- Create: `test/events.test.ts`

**Interfaces:**

```ts
// src/exit-protocol/types.ts
export type ExitActionId =
  | "complete-todoist-task"
  | "remove-worktree";

export type ExitActionResult = "completed" | "deferred" | "failed";

export interface ExitAction {
  id: ExitActionId;
  label: string;
  execute(): Promise<ExitActionResult>;
}
```

```ts
// src/shared/events.ts
import type { ExitAction } from "../exit-protocol/types.ts";

export type ShutdownReason = "quit" | "new" | "resume" | "fork" | "reload";

export interface SharedEventPayloads {
  prMerged: { prUrl: string };
  sessionWillClose: { reason: ShutdownReason };
}

export interface EventRequest<T> {
  readonly payload: T;
  readonly actions: readonly ExitAction[];
  addAction(action: ExitAction): void;
}

export type EventListener<T> =
  (request: EventRequest<T>) => void | Promise<void>;

export interface SharedEvents {
  on<K extends keyof SharedEventPayloads>(
    event: K,
    listener: EventListener<SharedEventPayloads[K]>,
    phase?: "collect" | "present",
  ): () => void;
  emit<K extends keyof SharedEventPayloads>(
    event: K,
    payload: SharedEventPayloads[K],
  ): Promise<void>;
}

export function createSharedEvents(): SharedEvents;
```

The bus must execute all `collect` listeners sequentially, then all `present` listeners sequentially, using one mutable action collector. A throwing listener is caught so later listeners still run. `on()` returns an unsubscribe function. A present listener receives the final action list after all collectors, so Todoist can be created after the exit presenter without losing actions.

- [ ] **Step 1: Write failing event-bus tests**

```ts
it("collects actions before present listeners run", async () => {
  const events = createSharedEvents();
  const order: string[] = [];
  const action = {
    id: "complete-todoist-task" as const,
    label: "Complete task",
    execute: async () => "completed" as const,
  };

  events.on("prMerged", (request) => {
    order.push("todoist");
    request.addAction(action);
  });
  events.on("prMerged", (request) => {
    order.push(`present:${request.actions.length}`);
  }, "present");

  await events.emit("prMerged", { prUrl: "https://github.com/o/r/pull/1" });

  expect(order).toEqual(["todoist", "present:1"]);
});
```

Also test unsubscribe, sequential async listener order, listener failure isolation, and independent action arrays for separate emits.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/events.test.ts`

Expected: FAIL because `src/shared/events.ts` and event implementation do not exist.

- [ ] **Step 3: Implement minimal typed bus**

Use a `Map<keyof SharedEventPayloads, ListenerRecord[]>`. Snapshot listeners before dispatch so unsubscribe during dispatch affects later emits, not the current event. Keep action collector private and expose a readonly copy through `request.actions`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/events.ts src/exit-protocol/types.ts test/events.test.ts
git commit -m "feat: add typed shared lifecycle events"
```

---

### Task 2: Extend project inspection and add worktree baseline logic

**Files:**

- Modify: `src/shared/project.ts`
- Modify: `test/git.test.ts`
- Create: `src/worktree/module.ts`
- Create: `test/worktree.test.ts`

**Interfaces:**

Extend `ProjectInfo` without removing existing fields:

```ts
export interface ProjectInfo {
  isWorktree: boolean;
  root: string | null;
  branch: string | null;
  mainRoot: string | null;
}
```

`inspectProject(exec, cwd)` must set `mainRoot` from the first `worktree ...` record when Git output is valid, and return `mainRoot: null` in its inert failure result. Update all exact object assertions.

Create the worktree module interface:

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Exec } from "../shared/command.ts";
import type { SharedEvents } from "../shared/events.ts";

export interface WorktreeModuleDependencies {
  exec?: Exec;
  changeDirectory?: (path: string) => void;
}

export interface WorktreeModule {
  sessionStart(ctx: ExtensionContext): Promise<void>;
  deactivate(): void;
}

export function createWorktreeModule(
  events: SharedEvents,
  dependencies?: WorktreeModuleDependencies,
): WorktreeModule;
```

Capture at `sessionStart`:

```ts
interface WorktreeBaseline {
  worktreePath: string;
  branch: string;
  mainRoot: string;
  initialHead: string;
  initialStatus: string;
}
```

Use `git rev-parse HEAD` and `git status --porcelain=v1 --untracked-files=all` with `ctx.cwd`. Trim only command framing whitespace, preserving status content. If any required lookup fails or project is not linked worktree, module stays inert.

- [ ] **Step 1: Add failing project-root assertions**

Update/add tests showing linked worktrees return `mainRoot: "/repo"` and main checkouts return `mainRoot: "/repo"`; failed lookups return `mainRoot: null`.

- [ ] **Step 2: Run project tests and verify failure**

Run: `npx vitest run test/git.test.ts`

Expected: FAIL because `ProjectInfo` lacks `mainRoot` and implementation does not expose it.

- [ ] **Step 3: Implement `mainRoot` parsing**

Keep path normalization through `resolveGitPath()`. Do not change merge parsing or worktree classification semantics.

- [ ] **Step 4: Add failing no-work detection tests**

Test these exact cases through the worktree module's injected command runner:

1. initial clean + same `HEAD` + final clean → no-work;
2. initial clean + changed `HEAD` + final clean → work done;
3. initial clean + same `HEAD` + final untracked/staged/unstaged status → work done;
4. initial dirty → never auto-classify as no-work;
5. any command failure → normal cleanup action path, never automatic deletion.

- [ ] **Step 5: Run focused worktree tests and verify failure**

Run: `npx vitest run test/worktree.test.ts`

Expected: FAIL because worktree module does not exist.

- [ ] **Step 6: Implement baseline capture and pure no-work classification**

Keep comparison in a small pure helper so tests can assert it without Pi context:

```ts
interface WorktreeCurrentState {
  currentHead: string;
  currentStatus: string;
}

export function hasNoSessionWork(
  baseline: Pick<WorktreeBaseline, "initialHead" | "initialStatus">,
  current: WorktreeCurrentState,
): boolean {
  return (
    baseline.initialHead === current.currentHead &&
    baseline.initialStatus === "" &&
    current.currentStatus === ""
  );
}
```

Use a correctly named current-state type in implementation; do not compare only filesystem status because committed work must count as work.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run test/git.test.ts test/worktree.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/project.ts src/worktree/module.ts test/git.test.ts test/worktree.test.ts
git commit -m "feat: track worktree session baseline"
```

---

### Task 3: Implement worktree event actions and safe cleanup

**Files:**

- Modify: `src/worktree/module.ts`
- Modify: `test/worktree.test.ts`

**Interfaces:**

The worktree module subscribes to `prMerged` and `sessionWillClose` during construction. It stores current `ExtensionContext`, baseline, pending cleanup approval, and an operation generation. It must become inert after `deactivate()`.

Action behavior:

- `prMerged`: if active linked worktree, add `remove-worktree` action whose execution sets pending cleanup approval and returns `"deferred"`; it never removes the worktree.
- `sessionWillClose` with non-`quit`: add no action and perform no cleanup.
- `sessionWillClose` with `quit`: inspect current state.
  - no-work + `hasUI`: remove immediately, add no action, notify exact text `Worktree deleted because no changes were made`;
  - work or uncertain state: add cleanup action;
  - no UI: add no action and perform no destructive cleanup.
- If cleanup action runs, recheck status. Dirty state requires `ctx.ui.confirm(...)`; refusal returns `"failed"` and leaves baseline/state intact.
- After approval, call `changeDirectory(mainRoot)` before any removal command. Use `git worktree remove [--force] worktreePath` with `{ cwd: mainRoot }`, then only if removal succeeds run `git branch -D branch` with `{ cwd: mainRoot }`.
- Notify success/failure. Never use `git push`, `git push --delete`, or remote refs.

Use injected `changeDirectory` defaulting to `process.chdir` and injected `exec` defaulting to `spawnExec`.

- [ ] **Step 1: Add failing event-action tests**

Test that `prMerged` contributes a deferred cleanup action and executes no Git removal commands. Test that `sessionWillClose` with `reason: "new"` contributes no action. Test that quit with changed state contributes the cleanup action.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/worktree.test.ts`

Expected: FAIL because event subscriptions and cleanup behavior are not implemented.

- [ ] **Step 3: Add failing cleanup command tests**

Assert exact calls:

```ts
expect(commands).toEqual([
  {
    command: "git",
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd: worktree,
  },
  {
    command: "git",
    args: ["worktree", "remove", worktree],
    cwd: mainRoot,
  },
  {
    command: "git",
    args: ["branch", "-D", branch],
    cwd: mainRoot,
  },
]);
```

Also test dirty confirmation false, dirty confirmation true with `--force`, removal failure preventing branch deletion, branch deletion failure after successful removal, root navigation before removal, and exact no-work notification.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `npx vitest run test/worktree.test.ts`

Expected: FAIL until cleanup implementation is present.

- [ ] **Step 5: Implement event subscriptions and cleanup**

Use generation checks around every awaited command and confirmation. Keep automatic no-work deletion before action registration so the exit presenter sees only an independent Todoist action, if any.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run test/worktree.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worktree/module.ts test/worktree.test.ts
git commit -m "feat: clean worktrees through exit events"
```

---

### Task 4: Build combined picker and exit-protocol presenter

**Files:**

- Create: `src/exit-protocol/picker.ts`
- Create: `src/exit-protocol/module.ts`
- Create: `test/exit-protocol.test.ts`

**Interfaces:**

Pure picker state:

```ts
export interface PickerState {
  readonly actionIds: readonly string[];
  readonly selectedIds: ReadonlySet<string>;
  readonly focused: "submit" | "action" | "cancel";
}

export function initialPickerState(actionIds: readonly string[]): PickerState;
export function toggleAction(state: PickerState, id: string): PickerState;
export function focusAction(state: PickerState, id: string): PickerState;
export function focusSubmit(state: PickerState): PickerState;
```

`initialPickerState()` must select every action and set `focused: "submit"`.

Presenter interface:

```ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SharedEvents } from "../shared/events.ts";

export interface ExitProtocolModule {
  sessionStart(ctx: ExtensionContext): void;
  deactivate(): void;
}

export function createExitProtocolModule(
  events: SharedEvents,
): ExitProtocolModule;
```

The module registers `present` listeners for `prMerged` and `sessionWillClose`. It shows no prompt for an empty action list. In TUI mode it uses `ctx.ui.custom()` with a checkbox component and explicit Submit/Cancel controls. Submit is initially focused and Enter executes selected actions in stable action order. Cancel and empty selection execute nothing. In RPC mode use sequential `ctx.ui.confirm()` calls in action order. In `hasUI === false`, execute nothing.

Execution results:

- `completed`: notify success is owned by action provider or presenter as appropriate;
- `deferred`: notify scheduling and retain pending state;
- `failed`: notify warning and retain action eligibility.

Do not invoke worktree deletion from `prMerged`; its action must only defer.

- [ ] **Step 1: Write failing picker-state tests**

```ts
it("starts with every action selected and Submit focused", () => {
  const state = initialPickerState(["complete-todoist-task", "remove-worktree"]);
  expect([...state.selectedIds]).toEqual([
    "complete-todoist-task",
    "remove-worktree",
  ]);
  expect(state.focused).toBe("submit");
});
```

Add tests for toggling one action, returning focus to Submit, cancel result, and stable execution order.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/exit-protocol.test.ts`

Expected: FAIL because picker and presenter do not exist.

- [ ] **Step 3: Implement pure picker state**

Keep action selection independent from terminal rendering. Preserve action ordering from event collection.

- [ ] **Step 4: Add failing presenter tests**

Use a fake `SharedEvents` bus and fake `ExtensionContext` to test:

- `prMerged` presents both registered actions in one prompt;
- all actions are selected by default;
- Submit is the default result without a toggle;
- unchecking one action executes only the other;
- Todoist completion executes immediately while worktree action returns deferred;
- no-work cleanup leaves only Todoist action for the prompt;
- no actions produce no prompt;
- RPC fallback confirms each action;
- no-UI mode performs no action.

- [ ] **Step 5: Run focused tests and verify failure**

Run: `npx vitest run test/exit-protocol.test.ts`

Expected: FAIL until presenter and UI adapter exist.

- [ ] **Step 6: Implement TUI/RPC presenter**

Use `ctx.ui.custom()` only when `ctx.mode === "tui"`. Render checkbox rows and Submit/Cancel controls with Pi theme. The component's initial focus target must be Submit; keyboard navigation may move to action rows, Space toggles, and Enter on Submit resolves selected IDs. Use `ctx.ui.confirm()` fallback for RPC.

- [ ] **Step 7: Run focused tests**

Run: `npx vitest run test/exit-protocol.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/exit-protocol/picker.ts src/exit-protocol/module.ts test/exit-protocol.test.ts
git commit -m "feat: add combined exit protocol picker"
```

---

### Task 5: Convert Todoist merge behavior to event-provided action

**Files:**

- Modify: `src/todoist/module.ts`
- Modify: `src/todoist/state.ts` only if legacy merge-prompt metadata needs compatibility handling
- Modify: `test/todoist.test.ts`
- Modify: `test/extension.test.ts`

**Interfaces:**

Add `SharedEvents` to `TodoistModuleDependencies`:

```ts
export interface TodoistModuleDependencies {
  // existing fields
  events?: SharedEvents;
}
```

The module registers a collect listener for `prMerged`. It contributes `complete-todoist-task` only when `context`, `ready`, and `state.taskRef` are active. The action label is:

```text
Mark Todoist task "<taskName>" complete
```

Action execution must use the existing `TodoistClient.completeTask(taskRef)`, clear task fields through `applyTodoistStatePatch`, append state, refresh status, and notify `Task marked as complete`. Failure retains task state and sends sanitized warning.

Remove the direct `mergeDetected()` method from the public `TodoistModule` interface and delete direct merge forwarding logic. Preserve stale-operation generation guards. Keep `mergePromptedPrUrl` compatibility for resumed sessions if needed, but no longer use it to suppress the shutdown action.

- [ ] **Step 1: Add failing Todoist event tests**

Test active task contributes the exact action label, selected completion clears task state, unselected task remains active, completion failure retains state, duplicate `prMerged` for the same PR does not produce duplicate action in one event, and a later `sessionWillClose` still contributes an uncompleted task.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/todoist.test.ts test/extension.test.ts`

Expected: FAIL because Todoist still exposes direct merge handling and does not subscribe to events.

- [ ] **Step 3: Implement event subscription and completion action**

Register listener once at module construction; listener checks current `context`, `ready`, operation generation, and task state. Unsubscribe in `deactivate()` or make listener generation-inert. Set merge marker before adding action if idempotence requires persistence, but do not clear task state until action execution succeeds.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/todoist.test.ts test/extension.test.ts`

Expected: PASS for updated Todoist/event tests.

- [ ] **Step 5: Commit**

```bash
git add src/todoist/module.ts src/todoist/state.ts test/todoist.test.ts test/extension.test.ts
git commit -m "refactor: expose Todoist completion through events"
```

---

### Task 6: Publish PR merge events through standalone merge detection

**Files:**

- Modify: `src/pr/module.ts`
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `test/extension.test.ts`
- Modify: `test/git.test.ts` only if merge-event integration needs new helper assertions

**Interfaces:**

Add `events?: SharedEvents` to `PrModuleDependencies`. Keep `detectMerge()` and `MergeEvent` in `src/shared/merge-detection.ts`.

When PR module records a merge, it must:

1. update PR state and append it;
2. clear/re-enable PR discovery as currently required;
3. emit `events.emit("prMerged", { prUrl })` after state recording;
4. avoid calling Todoist or worktree methods.

Because `sessionStart()` can detect an external merge before the extension has finished activating project-scoped modules, initialize active worktree/exit/Todoist listeners before invoking PR session startup. If startup ordering cannot guarantee that, queue merge event delivery until all active modules have completed `sessionStart`, then flush through the same shared bus. Tests must cover external startup merge delivery to an active Todoist module.

Remove `drainMergeEvents()` only after event delivery is proven for both external and tool-result merges. Keep `MergeEvent` as the normalized result of standalone merge detection, not as a cross-module method call.

- [ ] **Step 1: Add failing PR event tests**

Test verified tool merge emits exactly one `prMerged`, external merged PR emits one event during startup, failed/ambiguous merge emits none, and no Todoist/worktree direct method is called.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/git.test.ts test/extension.test.ts`

Expected: FAIL because PR module still returns/drains merge events for direct forwarding.

- [ ] **Step 3: Implement PR event publication**

Preserve existing operation-generation checks around asynchronous `findPrState()`/`detectMerge()` calls. Await event dispatch so merge-triggered task completion prompt completes deterministically before the current hook returns.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/git.test.ts test/extension.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pr/module.ts extensions/pi-todo-gate.ts test/extension.test.ts test/git.test.ts
git commit -m "feat: publish verified PR merges as events"
```

---

### Task 7: Wire worktree, exit protocol, lifecycle ordering, and shutdown event

**Files:**

- Modify: `extensions/pi-todo-gate.ts`
- Modify: `test/extension.test.ts`
- Modify: `test/worktree.test.ts`
- Modify: `test/exit-protocol.test.ts`

**Interfaces:**

`extension()` creates one `SharedEvents` instance, one worktree module, and one exit-protocol module. Dependencies expose optional factories only where tests need replacement:

```ts
export interface ExtensionDependencies {
  // existing fields
  events?: SharedEvents;
  worktreeModule?: WorktreeModule;
  exitProtocolModule?: ExitProtocolModule;
}
```

Do not pass `TodoistModule` or `WorktreeModule` into another module. The composition root owns creation; event subscriptions own communication.

Session-start order must make listeners active before PR can publish startup merge events:

1. establish current session generation;
2. call worktree and exit-protocol `sessionStart(ctx)`;
3. load Todoist config and create/reconfigure Todoist module;
4. call Todoist `sessionStart(event, ctx)` when configured;
5. call PR `sessionStart(event, ctx)`;
6. update active tools after all module initialization.

Preserve stale initialization guards: a newer `session_start` invalidates older async work, deactivates old Todoist state, and prevents stale event actions. Ensure the PR module still initializes for unconfigured projects.

Shutdown handler order:

```ts
pi.on("session_shutdown", async (event, ctx) => {
  ++sessionGeneration;
  await events.emit("sessionWillClose", {
    reason: event.reason,
  });
  pr.deactivate();
  todoist?.deactivate();
  worktree.deactivate();
  exitProtocol.deactivate();
  todoistActive = false;
});
```

Use the actual Pi shutdown reason type and do not default non-quit replacement events to quit if Pi always supplies a reason; tests must explicitly exercise every reason. Herdr cancellation remains independent and must not deactivate modules before `sessionWillClose` dispatch.

- [ ] **Step 1: Add failing integration tests**

Cover:

- configured session has one combined Todoist/worktree prompt after merge;
- unconfigured session has worktree action only;
- no-work worktree auto-deletes and active Todoist task still prompts;
- no-work worktree with no task emits exact notification and no prompt;
- selected worktree action is deferred after merge and cleaned only on quit;
- `/new`, `/resume`, `/fork`, `/reload` emit close event but do not complete/delete;
- shutdown emits event before module deactivation;
- rapid session replacement cannot execute stale actions;
- tools remain registered once after shutdown/restart.

- [ ] **Step 2: Run focused integration tests and verify failure**

Run: `npx vitest run test/extension.test.ts test/worktree.test.ts test/exit-protocol.test.ts`

Expected: FAIL until composition-root wiring is complete.

- [ ] **Step 3: Implement composition-root wiring**

Remove direct `pr.drainMergeEvents()` → `todoist.mergeDetected()` forwarding. Forward no module calls except lifecycle methods owned by the composition root. Keep `forwardSafely()` around module operations where existing behavior requires warning notifications.

- [ ] **Step 4: Run focused integration tests**

Run: `npx vitest run test/extension.test.ts test/worktree.test.ts test/exit-protocol.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-todo-gate.ts test/extension.test.ts test/worktree.test.ts test/exit-protocol.test.ts
git commit -m "feat: wire event-driven exit lifecycle"
```

---

### Task 8: Update documentation and run complete verification

**Files:**

- Modify: `docs/herdr-claim-gate-migration.md` if installation/lifecycle notes need the new module named.
- Modify: `docs/superpowers/specs/2026-08-31-exit-protocol-design.md` only if implementation reveals a clarified invariant; do not rewrite approved requirements silently.

- [ ] **Step 1: Add concise user-facing lifecycle documentation**

Document combined prompt labels, default Submit focus, no-work auto-delete notification, dirty confirmation, local-only branch deletion, and non-quit shutdown behavior. Keep Herdr setup documentation accurate and separate from exit protocol behavior.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS with all Vitest tests passing.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: PASS with no Biome diagnostics.

- [ ] **Step 5: Check diff and repository state**

Run: `git diff --check && git status --short --branch`

Expected: no whitespace errors; only intended committed changes; branch remains `cleanup-worktree-and-branch`.

- [ ] **Step 6: Commit documentation and verification fixes**

```bash
git add docs/herdr-claim-gate-migration.md
git commit -m "docs: describe exit protocol lifecycle"
```

Skip this commit only when documentation required no changes.

- [ ] **Step 7: Push feature branch and create PR**

```bash
git push -u origin cleanup-worktree-and-branch
gh pr create --base master --head cleanup-worktree-and-branch \
  --title "Add event-driven exit protocol" \
  --body "Implements shared PR/session-close events, combined preselected exit actions, safe deferred worktree cleanup, no-work auto-deletion, and Todoist completion integration."
```

Do not push to `master` or `main`. After PR creation, inspect PR comments before any merge.

---

## Plan self-review

- **Spec coverage:** Shared events, standalone merge detection, combined preselected UI, Submit focus, Todoist completion, deferred worktree cleanup, root navigation, dirty confirmation, no-work detection, no-work notification, independent Todoist prompt, non-quit suppression, failure retention, local-only branch handling, tests, typecheck, and lint map to Tasks 1–8.
- **Placeholder scan:** No TBD/TODO/"implement later" placeholders remain. Every task names files, interfaces, tests, commands, and expected outcomes.
- **Type consistency:** `SharedEvents`, `ExitAction`, `ShutdownReason`, `WorktreeModule`, and `ExitProtocolModule` signatures are introduced before consumers. Event listener phases ensure dynamically-created Todoist collectors run before the presenter.
- **Lifecycle consistency:** Physical worktree deletion occurs only from quit `sessionWillClose`; merge action execution only records deferred approval. No-work auto-delete removes the worktree before presenter action collection, allowing an independent Todoist action to remain.
