# Prompt Queue Module Design

- **Date:** 2026-09-15
- **Status:** Approved in chat
- **Scope:** Extract Prompt Queue into a first-class module and absorb Exit Protocol.

## Goals

- Make Prompt Queue the sole owner of prompt scheduling and prompt UI.
- Keep module boundaries one-way: Prompt Queue may know module state, events, and public module capabilities; feature modules must not know Prompt Queue.
- Preserve FIFO prompt ordering and stale-session protection.
- Move Exit Protocol behavior into Prompt Queue.
- Remove prompt-related UI from PR, Todoist, and Worktree modules.

## Non-goals

- Do not add prompt-request events.
- Do not add module-originated intent events.
- Do not add approval/result event channels for this migration.
- Do not persist queue, picker, or active prompt state.
- Do not move ordinary notifications out of their owning modules unless command ownership requires it.

## Module layout

Replace `src/prompt-queue.ts` and `src/exit-protocol/` with a first-class scoped module:

```text
src/prompt-queue/
  commands.ts
  constants.ts
  events.ts
  event-consumers.ts
  event-publishers.ts
  internal-state.ts
  module-state.ts
  module.ts
  notifications.ts
  user-prompts.ts
  queue.ts
```

`queue.ts` contains the FIFO queue algorithm currently in `src/prompt-queue.ts`. `event-consumers.ts` owns Event subscriptions and scheduling decisions. `user-prompts.ts` owns merge confirmation, Todoist completion confirmation, exit-action picker, and dirty-worktree confirmation. `module.ts` composes the module. Canonical facets remain present; facets with no responsibility use `export {}` rather than introducing unrelated responsibilities.

Register `prompt-queue` as a scoped domain and `queue.ts` as its declared additional facet. Update dependency rules to allow one-way Prompt Queue dependencies on public PR, Todoist, and Worktree capabilities while forbidding reverse dependencies. Prompt Queue must not import feature-module internal-state files.

## Composition and state

Root composition creates feature modules without Prompt Queue dependencies, then creates Prompt Queue with:

- `pi`;
- shared `eventHandler`;
- shared `sessionState`;
- public PR capability;
- public Todoist capability;
- public Worktree cleanup capability.

Prompt Queue subscribes to existing session lifecycle events and `prMergedEvent`. Root no longer resets or reaches into queue internals; lifecycle handling belongs to Prompt Queue.

Prompt Queue has no persisted session-state slice. Its queue epoch, active context/session identity, picker state, and pending work are transient. `module-state.ts` remains for module-structure consistency but does not add a persisted state contract. Remove `exitProtocol` from `ModuleState`, initial state, persistence descriptors, root composition, and extension state.

## Public capability changes

Feature modules expose non-interactive operation capabilities:

- **PR:** expose `mergeActivePr(): Promise<boolean>`. It validates current identity, performs the pinned PR merge, and preserves PR-owned success/failure notifications. It never prompts.
- **Todoist:** expose `completeMergedTask(snapshot): Promise<ExitActionResult>`, where `snapshot` is a public immutable completion snapshot containing the task identity, PR identity, work revision, and session ID. It validates the captured identity, performs completion, and preserves Todoist-owned notifications. It never prompts or queues UI.
- **Worktree:** retain worktree information inspection; expose non-interactive dirty-state inspection returning `Promise<boolean | null>` (`null` means unavailable); change cleanup to `removeWorktree(options: { force: boolean }): Promise<ExitActionResult>`. Cleanup revalidates current state and never calls `context.ui.*`.

Remove `PromptQueue` from PR, Todoist, and Worktree option/internal-operation types. Remove their prompt helper facets when no longer used. Keep `ExitActionResult` as a shared operation result; move function-bearing `ExitAction` picker data into Prompt Queue internals. Remove the old Exit Protocol module and its prompt/action implementation; move required picker behavior under Prompt Queue, using public Worktree capabilities.

## Data flow

### Merge command

Prompt Queue owns merge command registration and command-triggered orchestration:

1. Read active session and pinned PR state.
2. Reject inactive, non-interactive, or missing-PR cases using existing command semantics and notifications.
3. Enqueue merge confirmation into its FIFO queue.
4. If confirmed and still current, call PR’s public merge capability directly.
5. PR emits existing `prMergedEvent` after a successful merge.

No merge approval event is introduced.

### Merged event

Prompt Queue consumes existing `prMergedEvent`:

1. Capture current session identity and relevant Todoist/worktree data at event handling time.
2. Synchronously enqueue Todoist completion prompt job.
3. Synchronously enqueue exit-action picker job.
4. FIFO runs completion before exit picker, preserving current behavior.
5. After Todoist confirmation, call Todoist’s public completion capability directly.
6. In exit picker, call Worktree’s public cleanup capability directly for selected cleanup actions.

No prompt request or prompt result event is introduced. Prompt Queue may use existing domain events as triggers, but modules do not emit new prompt-related events.

### Dirty Worktree

Prompt Queue checks Worktree’s non-interactive dirty-state capability while executing the exit action. If dirty, it presents the dirty-removal confirmation. It passes the explicit decision to Worktree as `{ force }`. Worktree rechecks session and filesystem state before cleanup; stale or unavailable state fails safely without opening UI.

## Sequencing and stale work

- `queue.ts` retains Promise-chain FIFO semantics.
- Jobs appended while another job is running wait behind it.
- A successful PR merge can emit `prMergedEvent` during the merge job; its completion and exit jobs append behind the active job.
- Every job checks active context/session before UI, after UI, and before calling a module capability.
- Session deactivation/reset increments the queue epoch and clears Prompt Queue’s active context.
- Stale queued jobs resolve without calling module capabilities.
- Prompt/job failures are caught so one failed job does not block later FIFO jobs.
- Module operations retain their own identity checks and domain notifications.

## Error behavior

- Merge cancellation performs no merge.
- Todoist cancellation performs no completion; exit picker still runs.
- Todoist operation failure preserves existing failure notification and does not block exit handling.
- Empty exit-action sets produce no picker.
- Dirty-state inspection returning `null` produces no dirty confirmation; explicit cleanup reports failure through existing Worktree behavior.
- Session changes during any prompt suppress subsequent work.

## Testing

Move queue tests to the Prompt Queue module and retain coverage for order, reset, stale queued tasks, and stale visible prompts.

Add Prompt Queue module tests covering:

- merge command confirmation and direct PR capability call;
- cancellation and stale merge suppression;
- `prMergedEvent` synchronously appending completion before exit jobs;
- Todoist confirmation and direct completion capability call;
- exit picker selection and direct Worktree cleanup;
- dirty cleanup confirmation and explicit force propagation;
- lifecycle reset and stale-session suppression;
- failure isolation between FIFO jobs.

Update PR, Todoist, and Worktree tests to assert absence of Prompt Queue dependencies and UI prompts while retaining domain operation behavior. Update integration tests for merge, completion, exit ordering, and cleanup.

Update architecture checks for:

- first-class Prompt Queue facets and `queue.ts` allowance;
- Prompt Queue-only ownership of interactive prompts (`ui.confirm` and `ui.custom`); ordinary module notifications remain allowed;
- one-way Prompt Queue-to-module dependency direction;
- absence of `exit-protocol` and root queue utility remnants;
- no Prompt Queue references in feature modules.

Verification commands:

```text
npm test
npm run typecheck
npm run lint
```
