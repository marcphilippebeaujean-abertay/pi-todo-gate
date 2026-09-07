# Independent PR and Todoist Tracking Modules

## Status

Scope revised: task-claim architecture only. Implementation is deferred until written-spec review.

## Goal

Refactor the single `pi-todo-gate` extension so PR tracking and Todoist task claiming are independent domains while retaining one Pi extension entrypoint.

PR tracking must work in every normal project, even when no Todoist project is configured. Todoist task-claim analysis must remain conditional on a matching Todoist project configuration.

The first Todoist slice is a confirmation-gated claim flow. It reads Todoist, proposes either an existing task or a new task, presents the proposed action to the user, and mutates Todoist only after confirmation. The design must make the boundaries between CLI access, read-only analysis, user interaction, and session persistence explicit.

## Non-goals

- Do not split behavior into multiple Pi plugins.
- Do not preserve the combined public state tool or state-entry format.
- Do not add generic Todoist Pi commands in this phase. In particular, do not expose `set_task`, `create_task`, `remove_task`, `clear_task`, or `complete_task` as agent-invoked tool actions.
- Do not add a separate `TodoistCommands` command layer until the claim flow has been validated.
- Do not complete, remove, or clear tasks as a standalone action in this phase.
- Do not enable tracking inside dispatched subagent sessions.
- Do not change GitHub or Todoist CLI behavior beyond the tracking boundaries.

## Architecture

`extensions/pi-todo-gate.ts` remains the sole Pi extension entrypoint and composition root. It owns only Pi lifecycle registration, child-session exclusion, configuration loading, module activation, lifecycle forwarding, and context/status composition.

Proposed source layout:

```text
src/shared/
  command.ts          # Exec, CommandResult, spawnExec
  session-state.ts    # generic custom-entry read/write helpers
  project.ts          # Git project-root identity
  merge-detection.ts  # shared merge command parsing and PR matching

src/pr/
  module.ts           # PR lifecycle, tool, context, merge reminder
  state.ts            # PrState and merged-PR records
  detection.ts        # GitHub URL parsing
  git.ts              # PR lookup and shared merge exports
  footer.ts           # PR status rendering

src/todoist/
  module.ts           # Todoist lifecycle and claim context
  state.ts            # TodoistState
  client.ts           # Todoist CLI execution and parsing
  claim-worker.ts     # Read-only proposal worker
  claim-result.ts     # Worker result parsing and validation
  config.ts           # Todoist project mapping and resolution
  footer.ts           # Todoist status rendering
```

The exact file names may vary during implementation, but domain ownership and import direction must remain unchanged.

### Dependency rules

- PR code may import shared code and external dependencies, never Todoist code.
- Todoist code may import shared code and external dependencies, never PR code.
- Shared code may import neither domain.
- Only the extension composition root may import both domain entrypoints.
- `TodoistClient` may import shared command/parsing helpers but not session, UI, or extension lifecycle code.
- The claim worker may import worker/process and result-parser helpers, but never the Todoist client or mutation/orchestration code.
- The claim interaction may depend on the client and session/UI adapters, but no generic Todoist command module is allowed in this phase.
- Domain tests must not import the opposite domain's implementation.

## Domain state

PR and Todoist state use separate custom session entries.

```ts
type MergedPr = {
  prUrl: string;
  detectedAt: string;
  reminderPending: boolean;
};

type PrState = {
  prUrl?: string;
  mergedPrs?: MergedPr[];
  discoveryDisabled?: boolean;
};

type TodoistState = {
  taskRef?: string;
  taskName?: string;
  taskUrl?: string;
  mergePromptedPrUrl?: string;
};
```

Custom entry types:

- `pi-pr-gate-state`
- `pi-todoist-gate-state`

Generic session-state helpers must accept a custom type and domain state validator. A malformed entry in one domain must not affect the other domain.

PR state uses Git project-root identity for session handoff, so PR state can transfer across `/new` sessions without relying on Todoist configuration. Todoist state transfers only when the configured coding project matches.

Existing `pi-todo-gate-state` entries are not migrated. Existing combined tool behavior is intentionally removed.

## Public tools

Register only the PR state tool in this phase:

- `pi_pr_gate_state`
  - `status`
  - `set_pr`
  - `clear_pr`

Todoist registers no Pi-facing task command tool. There are no `set_task`, `create_task`, `remove_task`, `clear_task`, or `complete_task` actions for the agent to invoke. The claim flow is an extension-controlled interaction started from the agent prompt, not a general-purpose command surface. There is no `clear_all` operation because cross-domain mutation would violate separation.

## Activation and lifecycle

### Extension startup

1. Return immediately for `PI_SUBAGENT_CHILD=1`.
2. Always initialize the PR module for the current session.
3. Load Todoist configuration.
4. Initialize Todoist module only when configuration resolves the current project.
5. When the session becomes unconfigured, deactivate only the Todoist module; PR tracking remains active.

### PR module

On `session_start`:

- Read PR state.
- Inherit PR state from a previous session when Git project roots match.
- Discover the first valid PR URL not present in `mergedPrs`, unless discovery is disabled or an active PR exists.
- Check the active PR's external state.
- Treat a PR as merged only when GitHub reports `state: MERGED` and a non-empty `mergedAt`.

On `message_end`:

- Discover the first valid GitHub PR URL not present in `mergedPrs` when no active PR is set.

On successful Bash `tool_result`:

- Parse and validate merge commands with existing strict matching behavior.
- Confirm the command targets the active pinned PR.
- On confirmed merge, append one record to `mergedPrs`, clear active `prUrl`, and re-enable automatic discovery.
- Do not call Todoist or inspect Todoist state.

On `before_agent_start`:

- Recheck the active PR for external merges.
- If one or more merged records have `reminderPending`, add the exact reminder context.
- Mark those records as no longer pending and persist state.
- Keep merged URLs in history so they cannot be rediscovered.

On `set_pr`:

- Validate and set the active PR URL.
- Reset merge metadata for that URL.
- Permit explicit reuse by removing any matching URL from merged history.

On `clear_pr`:

- Clear active PR state and disable automatic discovery according to current explicit-clear semantics.
- Preserve merged history unless explicitly reset by a future design.

### Todoist module

On `session_start`:

- Resolve the configured project for the current path.
- If no project matches, remain inactive and register no Todoist status or context.
- Read Todoist state only after activation.
- If the session was created by clearing context and the previous session belongs to the same configured coding project, inherit its task state.
- Select active-task mode or claim-analysis mode.

The task-claim flow has four explicit boundaries:

1. **`TodoistClient`** owns `td` execution and parsing. It has no session state, prompts, or user decisions. Its narrow operations are `resolveProject`, `getTask`, `createTask`, `moveTask`, and `completeTask`; mutation methods are called only by the confirmed claim flow in this phase.
2. **Claim worker** runs in an isolated process and uses Todoist only for inspection. It never creates, moves, completes, clears, or otherwise mutates a task. It returns exactly one structured result:
   - `claim_existing`: task ID, title, and description for a non-completed matching task;
   - `create_new`: proposed title and description when no suitable non-completed task exists;
   - `error`: a safe human-readable reason when inspection or matching fails.
3. **Main-agent interaction** receives the proposal as hidden context, presents the action type, title, and description, and waits for explicit user confirmation. The proposal is not treated as a claim and is discarded when the session is stale or the user declines.
4. **Confirmed claim application** performs only the operation selected by the proposal, validates the configured project and task data, persists the resulting task state, and refreshes the footer. This is an internal claim flow, not a set of generic Pi-facing Todoist commands.

Any non-completed task may be claimed. The `In Progress` section is workflow state, not an ownership lock; an existing task in that section must not produce a collision or rejection solely because it is already `In Progress`.

The active-task context remains equivalent to:

```text
We are tracking tasks with Todoist and you are currently working on task task-ref.
Continue working on and tracking this task in Todoist.
```

While no task is linked, the extension may start claim analysis for the current prompt. It may provide a missing-task warning, but analysis and confirmation must not block unrelated agent work. No standalone Todoist command prompt is emitted.

### Context composition

The composition root forwards lifecycle events to both active modules. It concatenates their hidden context messages in deterministic order, with the PR merge reminder independent of Todoist activation.

A project without Todoist configuration can therefore receive PR discovery, PR state/tool behavior, PR footer status, and merge reminders without receiving Todoist instructions.

## Merge reminder semantics

Each confirmed merged PR gets its own record:

```ts
{
  prUrl: "https://github.com/owner/repo/pull/42",
  detectedAt: "2026-08-30T00:00:00Z",
  reminderPending: true
}
```

The active displayed PR is cleared immediately. The merged URL remains associated with its record and is excluded from future automatic discovery. The next distinct PR URL found in session output becomes active.

If multiple merges occur before the next prompt, one reminder context is sufficient; all pending records are marked delivered together. Pending records survive session shutdown because they are persisted in session state.

## Failure behavior

- Missing or malformed Todoist config leaves PR tracking active and Todoist inactive.
- Unavailable `gh` or unknown PR state produces no merge reminder; manual PR operations remain available.
- Todoist CLI errors are contained within Todoist claim behavior and may notify the user without disabling PR behavior.
- No Todoist failure can block PR discovery or reminder generation.
- No PR failure can mutate Todoist state.
- Worker failures return or surface an `error` proposal with sanitized details; worker output is never treated as a claim.
- Declined or stale proposals do not mutate Todoist or session state.
- A confirmed claim validates project membership before moving or creating a task, then persists state and refreshes the footer atomically from the session's perspective.
- Shared merge detection must remain independent of PR and Todoist implementations.

## Testing strategy

### PR unit tests

Cover:

- PR URL validation and discovery.
- Multiple merged PR records.
- Exact merged-PR association.
- Active PR clearing after confirmed merge.
- Excluding all merged URLs from discovery.
- Selecting the next distinct PR URL.
- Pending reminder delivery and persistence.
- External merge detection.
- PR behavior with empty Todoist configuration.

### Todoist unit tests

Cover:

- Configured and unconfigured activation.
- `TodoistClient` command argument construction and strict output parsing for project/task lookup and claim mutations.
- Read-only claim-worker prompts and structured result parsing for `claim_existing`, `create_new`, and `error`.
- Existing-task proposals include task ID, title, and description.
- New-task proposals include a non-empty title and description.
- Worker inspection never invokes create, move, complete, clear, or other mutation commands.
- Confirmation displays action type, title, and description before any mutation.
- Declined, stale, malformed, or error proposals do not mutate task or session state.
- Any non-completed task, including one already in `In Progress`, can be claimed without collision rejection.
- Confirmed claim validates project membership, persists session state, and refreshes the footer.
- No Todoist Pi-facing task command tool is registered.
- Todoist errors isolated from PR behavior.

### Extension integration tests

Cover:

- One extension loading both modules conditionally.
- PR module loading without Todoist config.
- Independent tools, statuses, and state entries.
- Combined context composition.
- Merge reminder without Todoist activation.
- User-confirmed Todoist completion choices after merge; no automatic completion or retry.
- Subagent exclusion.

### Architecture tests

Add ArchUnit-style source import assertions in `test/architecture.test.ts` enforcing the dependency rules above. These tests must fail if a PR module imports Todoist code, a Todoist module imports PR code, shared code imports either domain, or domain tests import the opposite implementation.

Run:

```bash
npm test
npm run typecheck
npm run lint
```

## Acceptance criteria

- One installed Pi extension remains the runtime entrypoint.
- PR tracking works in an unconfigured project.
- Todoist claim analysis exists only for configured projects.
- PR and Todoist modules have separate state, lifecycle logic, and status rendering.
- `TodoistClient` contains all `td` execution/parsing and has no session/UI dependencies.
- The claim worker is read-only and returns only `claim_existing`, `create_new`, or `error` proposals.
- The main-agent flow presents proposal action, title, and description and waits for explicit confirmation.
- Confirmed claims alone can mutate Todoist and session state; declined/stale/error proposals cannot.
- Any non-completed task can be claimed, including tasks already in `In Progress`.
- No generic Todoist Pi command actions are registered in this phase.
- Static architecture tests enforce no cross-domain imports and keep claim responsibilities separated.
- A merged PR clears the displayed PR and records its exact URL in merged history.
- A later distinct PR becomes the displayed active PR.
- Existing tests are updated or replaced to reflect intentional removal of combined state/tool compatibility and Todoist command actions.
