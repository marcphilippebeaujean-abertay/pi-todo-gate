# Prompt Queue Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Prompt Queue into a first-class scoped module that owns FIFO prompt orchestration, absorbs Exit Protocol, and calls PR, Todoist, and Worktree capabilities directly.

**Architecture:** `src/prompt-queue/` owns `queue.ts`, prompt UI, merge command orchestration, lifecycle invalidation, and `prMergedEvent` handling. Feature modules expose non-interactive capabilities and never import Prompt Queue. Existing `prMergedEvent` remains the only cross-module trigger; Prompt Queue emits no new approval or intent events.

**Tech Stack:** TypeScript, Vitest, Biome, dependency-cruiser, custom strict lint, Pi ExtensionAPI.

**Spec:** `docs/superpowers/specs/2026-09-15-prompt-queue-module-design.md`

## Global Constraints

- Prompt Queue must be a first-class scoped module with canonical facet files.
- `queue.ts` contains FIFO scheduling and stale-epoch invalidation.
- Prompt Queue owns `ui.confirm` and `ui.custom`; ordinary module notifications remain in owning modules.
- Feature modules must not import Prompt Queue or prompt helpers.
- Prompt Queue may depend on public PR, Todoist, and Worktree capabilities, but must not import their `internal-state.ts` files.
- Do not add prompt-request, module-originated intent, approval, or result events.
- Existing `prMergedEvent` remains the post-merge trigger.
- Queue, picker, active prompt, and session context state remain transient and unpersisted.
- Remove `exitProtocol` from composition, state, persistence descriptors, and tests.
- `Worktree.removeWorktree(options: { force: boolean })` must never open UI.
- Every queued job must suppress stale work before and after UI and before module capability calls.
- Verification commands are `npm test`, `npm run typecheck`, and `npm run lint`.

## File and responsibility map

### New files

- `src/prompt-queue/queue.ts`: `PromptQueue` FIFO class with `enqueue`, `reset`, and `drain`.
- `src/prompt-queue/commands.ts`: merge command registration and command-level validation.
- `src/prompt-queue/constants.ts`: merge and prompt copy/constants moved from prompt-owning feature facets.
- `src/prompt-queue/events.ts`: canonical empty facet; no new shared event channels.
- `src/prompt-queue/event-consumers.ts`: lifecycle and `prMergedEvent` subscriptions; queue job construction.
- `src/prompt-queue/event-publishers.ts`: canonical empty facet; no new approval/result events.
- `src/prompt-queue/internal-state.ts`: transient consumer dependencies, active context/session identity, exit action types, picker state, and public operation snapshots needed by Prompt Queue.
- `src/prompt-queue/module-state.ts`: canonical empty, unpersisted module-state facet.
- `src/prompt-queue/module.ts`: facet imports and `createPromptQueueModule` composition.
- `src/prompt-queue/notifications.ts`: Prompt Queue-owned command notifications moved with merge command ownership.
- `src/prompt-queue/user-prompts.ts`: merge confirmation, Todoist completion confirmation, dirty-worktree confirmation, and exit picker.
- `test/prompt-queue/queue.test.ts`: queue unit tests moved from `test/prompt-queue.test.ts`.
- `test/prompt-queue/module.test.ts`: Prompt Queue orchestration and UI tests migrated from Exit Protocol and new merge/completion tests.

### Modified files

- `src/main.ts`: compose feature modules without Prompt Queue dependencies, then create Prompt Queue; remove Exit Protocol and root queue utility composition.
- `src/event-consumer.ts`: remove direct queue reset and Exit Protocol types/state; retain root lifecycle/session handling.
- `src/state.ts`: remove `ExitProtocolModuleState` and `exitProtocol` from `ModuleState` and initial state.
- `src/session-state-persistence.ts`: remove Exit Protocol descriptor serialization/restoration.
- `src/pr/module.ts`, `src/pr/event-consumers.ts`, `src/pr/commands.ts`, `src/pr/constants.ts`, `src/pr/internal-state.ts`: expose non-interactive merge capability, remove command/prompt queue ownership, and move merge skill-path ownership to Prompt Queue.
- `src/todoist/module.ts`, `src/todoist/event-consumers.ts`, `src/todoist/completion.ts`, `src/todoist/internal-state.ts`: expose direct completion capability and remove Prompt Queue/prompt ownership.
- `src/worktree/module.ts`, `src/worktree/event-consumers.ts`, `src/worktree/internal-state.ts`: expose dirty-state inspection and explicit-force cleanup; remove UI confirmation.
- `src/shared/constants.ts`: remove Exit Protocol module constants that no longer have owners; retain operation constants needed by shared behavior.
- `scripts/check-module-structure.ts`: add Prompt Queue scoped domain and `queue.ts` facet; remove Exit Protocol assumptions.
- `.dependency-cruiser.cjs`: remove Exit Protocol rules and add one-way Prompt Queue dependency rules.
- `src/lint/rules/*.ts`: extend scoped-domain regexes and prompt ownership checks for Prompt Queue.
- `test/architecture/module-structure.test.ts`, `test/module-api-boundaries.test.ts`, lint tests: assert new module structure and public boundaries.
- `test/pr/merge-protocol.test.ts`, `test/pr/module.test.ts`: move command/UI assertions to Prompt Queue and test direct PR capability.
- `test/todoist/merge-prompt.test.ts`, `test/todoist/module.test.ts`, `test/integration/todoist-merge-consumer.test.ts`: move prompt orchestration assertions and test direct completion.
- `test/worktree/module.test.ts`: test explicit-force cleanup and no UI calls.
- `test/extension-session.test.ts`, `test/extensions/pi-todo-gate.test.ts`, `test/session-state-persistence.test.ts`, `test/session-state.test.ts`: remove Exit Protocol state/module expectations and assert Prompt Queue behavior.

### Deleted files

- `src/prompt-queue.ts`
- `src/exit-protocol/commands.ts`
- `src/exit-protocol/constants.ts`
- `src/exit-protocol/event-consumers.ts`
- `src/exit-protocol/event-publishers.ts`
- `src/exit-protocol/events.ts`
- `src/exit-protocol/internal-state.ts`
- `src/exit-protocol/module-state.ts`
- `src/exit-protocol/module.ts`
- `src/exit-protocol/notifications.ts`
- `src/exit-protocol/user-prompts.ts`
- `test/prompt-queue.test.ts`
- `test/exit-protocol/module.test.ts`

---

### Task 1: Establish Prompt Queue module and preserve queue semantics

**Files:**
- Create: `src/prompt-queue/queue.ts`
- Create: `src/prompt-queue/commands.ts`
- Create: `src/prompt-queue/constants.ts`
- Create: `src/prompt-queue/events.ts`
- Create: `src/prompt-queue/event-consumers.ts`
- Create: `src/prompt-queue/event-publishers.ts`
- Create: `src/prompt-queue/internal-state.ts`
- Create: `src/prompt-queue/module-state.ts`
- Create: `src/prompt-queue/module.ts`
- Create: `src/prompt-queue/notifications.ts`
- Create: `src/prompt-queue/user-prompts.ts`
- Create: `test/prompt-queue/queue.test.ts`
- Modify: `scripts/check-module-structure.ts`
- Modify: `.dependency-cruiser.cjs`
- Modify: `test/architecture/module-structure.test.ts`
- Delete: `src/prompt-queue.ts`
- Delete: `test/prompt-queue.test.ts`

**Interfaces:**
- Produces `PromptQueue` in `src/prompt-queue/queue.ts` with:
  ```ts
  export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;

  export class PromptQueue {
    enqueue<T>(task: PromptTask<T>): Promise<T | undefined>;
    reset(): void;
    drain(): Promise<void>;
  }
  ```
- Produces a scoped-domain structure recognized by `checkModuleStructure`.

- [ ] **Step 1: Move queue tests and change import path**

Move the four existing tests without changing their assertions. Change the import to:

```ts
import { PromptQueue } from "../../src/prompt-queue/queue.ts";
```

Keep coverage for enqueue order, reset dropping queued tasks, stale return values, and stale visible prompts.

- [ ] **Step 2: Run queue tests to verify the new module is missing**

Run: `npx vitest run test/prompt-queue/queue.test.ts`

Expected: FAIL because `src/prompt-queue/queue.ts` does not exist.

- [ ] **Step 3: Create queue implementation and structural facets**

Copy the current queue implementation into `src/prompt-queue/queue.ts` without behavior changes. Create the canonical facet files. Each currently unused facet must contain exactly `export {};` until a later task gives it a responsibility. Make `module.ts` import every facet so dependency-cruiser sees the complete module shape.

Add `"prompt-queue"` to `SCOPED_DOMAINS`, add `"queue.ts"` to `ADDITIONAL_FACETS.prompt-queue`, and update scoped-domain regular expressions. Remove checks that require root `src/prompt-queue.ts`; replace them with a check rejecting `src/shared/prompt-queue.ts` and the deleted root utility.

Add dependency rules allowing only `src/prompt-queue/` to import public `src/pr/module.ts`, `src/todoist/module.ts`, and `src/worktree/module.ts`. Add reverse-direction forbidden rules for those feature modules importing `src/prompt-queue/`.

- [ ] **Step 4: Run queue and structure tests**

Run: `npx vitest run test/prompt-queue/queue.test.ts test/architecture/module-structure.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-queue test/prompt-queue/queue.test.ts scripts/check-module-structure.ts .dependency-cruiser.cjs test/architecture/module-structure.test.ts
git rm src/prompt-queue.ts test/prompt-queue.test.ts
git commit -m "Extract prompt queue module"
```

---

### Task 2: Make Worktree cleanup non-interactive

**Files:**
- Modify: `src/worktree/internal-state.ts`
- Modify: `src/worktree/module.ts`
- Modify: `src/worktree/event-consumers.ts`
- Modify: `src/worktree/constants.ts`
- Delete: `src/worktree/user-prompts.ts`
- Modify: `test/worktree/module.test.ts`
- Modify: `test/module-api-boundaries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WorktreeCleanup {
    getWorktreeInfo(): WorktreeInfo | null;
    hasUncommittedChanges(): Promise<boolean | null>;
    removeWorktree(options: { force: boolean }): Promise<ExitActionResult>;
  }
  ```
- `null` from `hasUncommittedChanges()` means cleanup status is unavailable.
- `removeWorktree({ force })` never calls `context.ui.confirm`.

- [ ] **Step 1: Add failing no-UI and explicit-force tests**

Update the test module type to require `hasUncommittedChanges()` and `removeWorktree({ force })`. Add tests that:

```ts
await expect(module.hasUncommittedChanges()).resolves.toBe(true);
await expect(module.removeWorktree({ force: true })).resolves.toBe("completed");
expect(context.ui.confirm).not.toHaveBeenCalled();
```

Add a dirty cleanup test with `{ force: false }` that verifies cleanup is not forced and no confirmation is requested. Retain existing session, filesystem, and cleanup notification assertions.

- [ ] **Step 2: Run Worktree tests to verify failure**

Run: `npx vitest run test/worktree/module.test.ts`

Expected: FAIL because current public signature has no options, no dirty inspection method exists, and current cleanup calls `confirmDirtyRemoval`.

- [ ] **Step 3: Implement explicit-force cleanup**

Move dirty-status inspection from `executeCleanup` into `hasUncommittedChanges()`. Return `null` when there is no current Worktree baseline, no active context/session, or status inspection returns `null`; return the filesystem status boolean otherwise.

Change `removeWorktree` and `executeCleanup` to accept `{ force: boolean }`. Recheck current session, baseline, and filesystem state. If the current status is dirty and `force` is false, return the existing failed result without UI. Pass the explicit force value to `cleanupNow`. Delete `confirmDirtyRemoval` and its prompt constants/imports.

- [ ] **Step 4: Run Worktree tests and API boundary tests**

Run: `npx vitest run test/worktree/module.test.ts test/module-api-boundaries.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktree test/worktree/module.test.ts test/module-api-boundaries.test.ts
git commit -m "Remove worktree prompt ownership"
```

---

### Task 3: Expose direct PR merge capability and move command ownership

**Files:**
- Modify: `src/pr/module.ts`
- Modify: `src/pr/event-consumers.ts`
- Modify: `src/pr/commands.ts`
- Modify: `src/pr/constants.ts`
- Modify: `src/pr/internal-state.ts`
- Modify: `test/pr/module.test.ts`
- Modify: `test/pr/merge-protocol.test.ts`
- Modify: `test/module-api-boundaries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PrModule {
    mergeActivePr(): Promise<boolean>;
  }
  ```
- `mergeActivePr()` performs merge and existing PR notifications/event publication without UI confirmation.
- PR module no longer exports or registers `registerMergeProtocol`.

- [ ] **Step 1: Add failing direct-capability tests**

Add a PR module test that creates an active session with a pinned PR, calls `mergeActivePr()`, and asserts the configured executor receives:

```ts
"gh",
["pr", "merge", PR_URL, "--merge"],
{ cwd: REPOSITORY_ROOT }
```

Assert `context.ui.confirm` is never called. Add cancellation-independent coverage by removing the old command confirmation expectation from the PR test and asserting command registration is absent from `createPrModule`.

- [ ] **Step 2: Run PR tests to verify failure**

Run: `npx vitest run test/pr/module.test.ts test/pr/merge-protocol.test.ts`

Expected: FAIL because `PrModule` has no public merge capability and command registration is still inside PR.

- [ ] **Step 3: Implement direct PR capability**

Add `mergeActivePr()` to `PrConsumer` and `PrModule`. Reuse existing current-session validation, pinned PR lookup, merge execution, failure-detail formatting, `mergePinnedPr`, success/failure notifications, and `publishPrMerged`. Remove `confirmAndMerge`, command UI validation, and `registerMergeProtocol` registration from PR. Keep PR git/parsing helpers in their existing facets.

Remove `promptQueue` from `PrModuleOptions`. Remove PR prompt imports and any queue-based session operation dependency that only served command confirmation. Keep session operation serialization for PR operations that still require it.

- [ ] **Step 4: Update PR command tests for relocation**

Replace `test/pr/merge-protocol.test.ts` command registration tests with assertions that PR no longer registers `/merge`. Keep skill-content assertions only if the skill remains packaged; move command handler and confirmation assertions to Prompt Queue tests in Task 5.

- [ ] **Step 5: Run PR and boundary tests**

Run: `npx vitest run test/pr test/module-api-boundaries.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pr test/pr test/module-api-boundaries.test.ts
git commit -m "Expose non-interactive PR merge capability"
```

---

### Task 4: Expose direct Todoist completion capability

**Files:**
- Modify: `src/todoist/module.ts`
- Modify: `src/todoist/event-consumers.ts`
- Modify: `src/todoist/completion.ts`
- Modify: `src/todoist/internal-state.ts`
- Delete: `src/todoist/user-prompts.ts`
- Modify: `test/todoist/module.test.ts`
- Modify: `test/todoist/merge-prompt.test.ts`
- Modify: `test/integration/todoist-merge-consumer.test.ts`

**Interfaces:**
- Produces public immutable snapshot and capability:
  ```ts
  export interface TodoistCompletionSnapshot {
    taskRef: string;
    taskName: string;
    prUrl: string;
    workRevision: number;
    sessionId: string;
  }

  export interface TodoistModule {
    completeMergedTask(snapshot: TodoistCompletionSnapshot): Promise<ExitActionResult>;
  }
  ```
- `completeMergedTask` performs no UI and no Prompt Queue scheduling.

- [ ] **Step 1: Add failing direct-completion tests**

Add a module test that calls `completeMergedTask(snapshot)` with the current task/PR/session identity and asserts the Todoist client completes the task. Assert no `context.ui.confirm` call occurs. Add a stale snapshot test that asserts no client request occurs.

- [ ] **Step 2: Run Todoist tests to verify failure**

Run: `npx vitest run test/todoist/module.test.ts test/todoist/merge-prompt.test.ts test/integration/todoist-merge-consumer.test.ts`

Expected: FAIL because completion currently requires internal session/context arguments and merged-event handling imports Prompt Queue and prompt helpers.

- [ ] **Step 3: Implement direct completion**

Move `TodoistCompletionSnapshot` to the public module-facing type location. Add `completeMergedTask(snapshot)` to `TodoistModule` and adapt existing completion logic so the module resolves its current session/context internally, validates task reference, PR URL, work revision, and session ID, then performs the existing Todoist request and state update.

Delete `completeMergedTaskAfterPrompt`, `confirmTaskCompletion`, and the Prompt Queue enqueue from `consumeMergedEvent`. Keep `prMergedEvent` subscription only if Todoist still needs non-prompt merge bookkeeping; it must not call UI or Prompt Queue.

Remove `promptQueue` from `TodoistModuleOptions` and `TodoistOperations`. Preserve session operation serialization and existing success/failure notifications.

- [ ] **Step 4: Rewrite prompt tests as direct-capability tests**

Remove tests that expect Todoist to enqueue or present a confirmation. Keep tests for completion identity guards, successful state updates, failed completion, and stale merge results. Move confirmation assertions to Prompt Queue tests in Task 5.

- [ ] **Step 5: Run Todoist tests**

Run: `npx vitest run test/todoist test/integration/todoist-merge-consumer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/todoist test/todoist test/integration/todoist-merge-consumer.test.ts
git commit -m "Expose non-interactive Todoist completion"
```

---

### Task 5: Implement Prompt Queue orchestration and all prompt UI

**Files:**
- Modify: `src/prompt-queue/commands.ts`
- Modify: `src/prompt-queue/constants.ts`
- Modify: `src/prompt-queue/events.ts`
- Modify: `src/prompt-queue/event-consumers.ts`
- Modify: `src/prompt-queue/internal-state.ts`
- Modify: `src/prompt-queue/module.ts`
- Modify: `src/prompt-queue/notifications.ts`
- Modify: `src/prompt-queue/user-prompts.ts`
- Modify: `test/prompt-queue/module.test.ts`
- Move/adapt: `test/exit-protocol/module.test.ts` into `test/prompt-queue/module.test.ts`
- Modify: `test/pr/merge-protocol.test.ts`

**Interfaces:**
- Consumes `PrModule.mergeActivePr()`, `TodoistModule.completeMergedTask(snapshot)`, `WorktreeCleanup.getWorktreeInfo()`, `WorktreeCleanup.hasUncommittedChanges()`, and `WorktreeCleanup.removeWorktree({ force })`.
- Produces `createPromptQueueModule(options)` with Prompt Queue-owned subscriptions and command registration. It exposes no lifecycle methods or queue internals on its public module API.

- [ ] **Step 1: Add failing Prompt Queue orchestration tests**

Create test doubles for public PR, Todoist, and Worktree capabilities. Add tests that assert:

```ts
await mergeCommand.handler("", context);
await queue.drain();
expect(context.ui.confirm).toHaveBeenCalledWith(
  `Merge PR ${PR_URL}?`,
  "Confirm merge of pinned pull request.",
);
expect(pr.mergeActivePr).toHaveBeenCalledOnce();
```

Add a `prMergedEvent` test that emits one merge event, drains the queue, and asserts call order:

```text
Todoist confirmation
Todoist completion
Exit picker
Worktree cleanup
```

Add tests for cancelled Todoist completion still allowing exit picker, dirty Worktree confirmation passing `{ force: true }`, empty actions skipping picker, no UI skipping prompts, and stale session reset suppressing all later calls.

Migrate Exit Protocol picker tests without changing picker keyboard behavior or rendered output assertions.

- [ ] **Step 2: Run Prompt Queue tests to verify failure**

Run: `npx vitest run test/prompt-queue/module.test.ts`

Expected: FAIL because consumer, command, prompts, and module composition are still empty.

- [ ] **Step 3: Implement Prompt Queue public dependencies and lifecycle consumer**

Define options containing `pi`, `eventHandler`, `sessionState`, `pr`, `todoist`, `worktree`, and an injectable queue for tests. Store active `ExtensionContext` and `sessionId` from `sessionActivatedEvent`. On `sessionDeactivatedEvent`, clear context/session and call `queue.reset()`.

Subscribe to `prMergedEvent`. Capture the active session identity, Todoist completion snapshot, Worktree information, and action data at event handling time. Call `queue.enqueue(...)` twice synchronously: first completion job, second exit-picker job.

Use `isCurrent()` guards before UI, after UI, and before each direct capability call. Catch each enqueue promise so a failed job cannot stop later queue jobs.

- [ ] **Step 4: Implement Prompt Queue UI and exit actions**

Move merge confirmation, Todoist completion confirmation, and Exit Protocol picker implementation into `user-prompts.ts`. Keep picker state and function-bearing action objects internal to Prompt Queue. Build the remove-worktree action from the public Worktree capability.

For selected worktree cleanup, call `hasUncommittedChanges()`. If it returns `true`, present the dirty-removal confirmation. Pass the answer as `{ force: confirmed }` to `removeWorktree`. If it returns `false`, call `{ force: false }`. If it returns `null`, do not prompt and call `{ force: false }` so Worktree reports failure.

- [ ] **Step 5: Implement merge command orchestration**

Move `/merge` registration and merge skill resource discovery into Prompt Queue `commands.ts`. Preserve current inactive-session, missing-PR, no-UI, confirmation copy, failure, and success behavior. The command handler enqueues confirmation; after approval and a current-session check, it calls `pr.mergeActivePr()` directly.

Do not add a shared event for merge approval. Do not import PR `internal-state.ts`; read pinned PR state from `SessionState` and call only `PrModule` public capability.

- [ ] **Step 6: Run Prompt Queue tests**

Run: `npx vitest run test/prompt-queue/module.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/prompt-queue test/prompt-queue/module.test.ts test/pr/merge-protocol.test.ts
git rm -r test/exit-protocol
git commit -m "Centralize prompt orchestration"
```

---

### Task 6: Recompose root state and remove Exit Protocol

**Files:**
- Modify: `src/main.ts`
- Modify: `src/event-consumer.ts`
- Modify: `src/state.ts`
- Modify: `src/session-state-persistence.ts`
- Modify: `src/shared/constants.ts`
- Modify: `test/extension-session.test.ts`
- Modify: `test/extensions/pi-todo-gate.test.ts`
- Modify: `test/session-state-persistence.test.ts`
- Modify: `test/session-state.test.ts`
- Modify: `test/root-state.test.ts`
- Delete: `src/exit-protocol/`

**Interfaces:**
- Root composition contains Prompt Queue module dependencies without exposing queue internals to feature modules.
- `ModuleState` no longer has `exitProtocol`.
- Session persistence serializes only remaining module states.

- [ ] **Step 1: Add failing root/state assertions**

Update tests to expect no `exitProtocol` state key and no `exitProtocol` root property. Add a composition test that creates the extension and verifies Prompt Queue receives PR, Todoist, and Worktree public capabilities. Assert session shutdown resets Prompt Queue through lifecycle event delivery rather than a root call to `promptQueue.reset()`.

- [ ] **Step 2: Run root and persistence tests to verify failure**

Run: `npx vitest run test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts test/session-state-persistence.test.ts test/session-state.test.ts test/root-state.test.ts`

Expected: FAIL because root composition and persistence still construct and serialize Exit Protocol and the root queue utility.

- [ ] **Step 3: Update composition**

Remove `PromptQueue` utility construction from root composition. Construct PR, Todoist, and Worktree without queue options. Construct Prompt Queue with `pi`, shared events/state, and public capabilities. Remove Exit Protocol construction and properties. Preserve module initialization order so PR/Todoist/Worktree subscriptions are ready before Prompt Queue subscribes to `prMergedEvent`.

Remove direct queue reset from root `deactivate`. Prompt Queue resets itself from `sessionDeactivatedEvent`.

- [ ] **Step 4: Remove Exit Protocol state and persistence**

Delete Exit Protocol imports/types/state initialization from `src/state.ts`, `src/main.ts`, and `src/event-consumer.ts`. Remove its descriptor serialization/restoration from `src/session-state-persistence.ts`. Remove obsolete module constants from `src/shared/constants.ts` while retaining shared exit operation result constants used by Worktree/Todoist.

- [ ] **Step 5: Run root and persistence tests**

Run: `npx vitest run test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts test/session-state-persistence.test.ts test/session-state.test.ts test/root-state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/event-consumer.ts src/state.ts src/session-state-persistence.ts src/shared/constants.ts test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts test/session-state-persistence.test.ts test/session-state.test.ts test/root-state.test.ts
git rm -r src/exit-protocol
git commit -m "Replace exit protocol with prompt queue"
```

---

### Task 7: Enforce architecture and finish integration coverage

**Files:**
- Modify: `.dependency-cruiser.cjs`
- Modify: `scripts/check-module-structure.ts`
- Modify: `src/lint/rules/commands-only-register.ts`
- Modify: `src/lint/rules/event-types-location.ts`
- Modify: `src/lint/rules/event-types-outside-events.ts`
- Modify: `src/lint/rules/functions-per-file.ts`
- Modify: `src/lint/rules/no-direct-module-state-write.ts`
- Modify: `src/lint/rules/no-domain-types-outside-state.ts`
- Modify: `src/lint/rules/no-event-handler-emits-outside-publishers.ts`
- Modify: `src/lint/rules/no-event-handler-subscriptions-in-modules.ts`
- Modify: `src/lint/rules/no-extension-state-in-modules.ts`
- Modify: `src/lint/rules/no-internal-state-imports.ts`
- Modify: `test/architecture/module-structure.test.ts`
- Modify: `test/lint/event-types-location.test.ts`
- Modify: `test/lint/event-types-outside-events.test.ts`
- Modify: `test/lint/module-state-contract.test.ts`
- Modify: `test/lint/no-direct-module-state-write.test.ts`
- Modify: `test/lint/no-domain-types-outside-state.test.ts`
- Modify: `test/lint/no-event-handler-emits-outside-publishers.test.ts`
- Modify: `test/lint/no-event-handler-subscriptions-in-modules.test.ts`
- Modify: `test/lint/no-extension-state-in-modules.test.ts`
- Modify: `test/lint/no-internal-state-imports.test.ts`
- Modify: `test/module-api-boundaries.test.ts`
- Modify: `test/integration/todoist-merge-consumer.test.ts`
- Modify: `test/extensions/pi-todo-gate.test.ts`

**Interfaces:**
- Architecture checks recognize `prompt-queue` as the only prompt-owning scoped module.
- No production source outside `src/prompt-queue/` contains `ui.confirm` or `ui.custom`.
- No production feature module imports `src/prompt-queue/`.

- [ ] **Step 1: Add failing architecture assertions**

Add fixtures asserting `ui.confirm` and `ui.custom` are accepted under `src/prompt-queue/` and rejected under `src/pr/`, `src/todoist/`, and `src/worktree/`. Add dependency fixtures asserting Prompt Queue may import public module entrypoints but not their `internal-state.ts` files. Add checks that no `src/exit-protocol` path or root `src/prompt-queue.ts` remains.

- [ ] **Step 2: Run architecture and lint tests to verify failure**

Run: `npm run architecture && npm run lint`

Expected: FAIL with stale Exit Protocol regexes, missing Prompt Queue domain handling, or prompt ownership violations.

- [ ] **Step 3: Update architecture and lint rules**

Add `prompt-queue` to every scoped-domain regex and module-file rule. Keep event subscriptions allowed only in `event-consumers.ts`; keep event emissions restricted to `event-publishers.ts`. Add Prompt Queue command registration to the allowed `commands.ts` rule. Add explicit prompt ownership validation for `ui.confirm` and `ui.custom`.

Update dependency-cruiser forbidden rules to remove Exit Protocol and forbid reverse Prompt Queue imports. Keep Prompt Queue public module imports allowed and internal-state imports forbidden.

- [ ] **Step 4: Update integration expectations**

Ensure full extension integration verifies merge confirmation, direct PR merge, Todoist confirmation/completion, exit picker ordering, dirty Worktree confirmation, stale session suppression, and operation failure isolation. Assert no Prompt Queue dependency appears in PR, Todoist, or Worktree test setup.

- [ ] **Step 5: Run focused architecture and integration checks**

Run:

```bash
npm run architecture
npm run lint
npx vitest run test/integration/todoist-merge-consumer.test.ts test/extensions/pi-todo-gate.test.ts test/module-api-boundaries.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .dependency-cruiser.cjs scripts/check-module-structure.ts src/lint test/architecture test/lint test/module-api-boundaries.test.ts test/integration/todoist-merge-consumer.test.ts test/extensions/pi-todo-gate.test.ts
git commit -m "Enforce prompt queue module boundaries"
```

---

### Task 8: Full verification and review checkpoint

**Files:**
- Inspect: files created or modified by Tasks 1–7; no planned source edits.

**Interfaces:**
- Final implementation matches `docs/superpowers/specs/2026-09-15-prompt-queue-module-design.md`.

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
```

Expected: all commands exit with status 0.

- [ ] **Step 2: Inspect final dependency and diff state**

Run:

```bash
git diff --check "$(git merge-base HEAD master)"
git status --short
rg -n "exit-protocol|src/prompt-queue\.ts|PromptQueue|ui\.confirm|ui\.custom" src extensions test --glob '*.ts'
```

Expected: Production Prompt Queue references occur only in `src/prompt-queue/` and root composition; production `ui.confirm` and `ui.custom` occur only in `src/prompt-queue/`; no Exit Protocol or root queue utility paths remain; worktree is clean except intentional user changes.

- [ ] **Step 3: Review final diff against spec**

Check each spec requirement: first-class facets, direct capability calls, synchronous FIFO enqueue order, stale-session guards, non-interactive Worktree cleanup, no new prompt/intent/result events, no persisted Prompt Queue state, removed Exit Protocol, and updated architectural enforcement.

- [ ] **Step 4: Record verification result**

If a verification command fails, stop completion claim, identify failed requirement, and return to the task that owns the failing file. Apply its smallest test-backed correction there, rerun the failed command, and commit that correction with the owning task’s commit scope. Do not create an untracked final-fix commit with unspecified files.
