# Independent PR and Todoist Tracking Modules

## Status

Design approved in chat. Implementation deferred until written-spec review.

## Goal

Refactor the single `pi-todo-gate` extension so PR tracking and Todoist task tracking are independent domains while retaining one Pi extension entrypoint.

PR tracking must work in every normal project, even when no Todoist project is configured. Todoist behavior must remain conditional on a matching Todoist project configuration.

After a confirmed PR merge, the extension must add this hidden context to the next agent prompt:

> Please ensure you have closed all completed tasks for this session if you have been using task tracking

The extension must not automatically complete Todoist tasks after a merge.

## Non-goals

- Do not split behavior into multiple Pi plugins.
- Do not preserve the combined public state tool or state-entry format.
- Do not add a new Todoist completion workflow.
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

src/pr/
  module.ts           # PR lifecycle, tool, context, merge reminder
  state.ts            # PrState and merged-PR records
  detection.ts        # GitHub URL parsing
  git.ts              # PR lookup and merge matching
  footer.ts           # PR status rendering

src/todoist/
  module.ts           # Todoist lifecycle, tool, context
  state.ts            # TodoistState
  client.ts           # Todoist CLI client
  config.ts           # Todoist project mapping and resolution
  footer.ts           # Todoist status rendering
```

The exact file names may vary during implementation, but domain ownership and import direction must remain unchanged.

### Dependency rules

- PR code may import shared code and external dependencies, never Todoist code.
- Todoist code may import shared code and external dependencies, never PR code.
- Shared code may import neither domain.
- Only the extension composition root may import both domain entrypoints.
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
};
```

Custom entry types:

- `pi-pr-gate-state`
- `pi-todoist-gate-state`

Generic session-state helpers must accept a custom type and domain state validator. A malformed entry in one domain must not affect the other domain.

PR state uses Git project-root identity for session handoff, so PR state can transfer across `/new` sessions without relying on Todoist configuration. Todoist state transfers only when the configured coding project matches.

Existing `pi-todo-gate-state` entries are not migrated. Existing combined tool behavior is intentionally removed.

## Public tools

Register tools independently:

- `pi_pr_gate_state`
  - `status`
  - `set_pr`
  - `clear_pr`
- `pi_todoist_gate_state`
  - `status`
  - `set_task`
  - `clear_task`

Neither tool exposes operations owned by the other domain. There is no `clear_all` operation because cross-domain mutation would violate separation.

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
- If no project matches, remain inactive and register no Todoist tool/status/context.
- Read Todoist state.
- If the session was created by clearing context and the previous session belongs to the same configured coding project, inherit its task state.
- Select active-task mode or new-task mode.

Before generating context, attempt existing task inference from session history/current prompt. Then:

Active-task mode emits context equivalent to:

```text
We are tracking tasks with Todoist and you are currently working on task task-ref.
Continue working on and tracking this task in Todoist.
```

New-task mode emits instructions equivalent to:

```text
# Todoist Task Gate (MANDATORY)

Before code changes:
1. Find or create a Todoist task matching this work in the configured project.
2. Assign it through pi_todoist_gate_state using set_task.
3. Do not proceed until task is claimed and tracked.
```

The new-task context must identify the configured Todoist project and must not contain a hardcoded project ID.

`set_task` validates the task, ensures it belongs to the configured project, and moves it to `In Progress`. `clear_task` removes task state and returns the module to new-task mode.

The Todoist module never receives merge events and never completes tasks because a PR merged.

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
- Todoist CLI errors are contained within Todoist behavior and may notify the user without disabling PR behavior.
- No Todoist failure can block PR discovery or reminder generation.
- No PR failure can mutate Todoist state.
- Remove Todoist completion retry timers and completion metadata from state and runtime.

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
- New-task prompt with configured project identity.
- Active current-task prompt.
- Inherited-task prompt after `/new`.
- Clear-task returning to new-task mode.
- Task inference, claim, project validation, and move behavior.
- Todoist errors isolated from PR behavior.

### Extension integration tests

Cover:

- One extension loading both modules conditionally.
- PR module loading without Todoist config.
- Independent tools, statuses, and state entries.
- Combined context composition.
- Merge reminder without Todoist activation.
- No automatic Todoist completion or retry after merge.
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
- Todoist tracking exists only for configured projects.
- PR and Todoist modules have separate state, tools, lifecycle logic, and status rendering.
- Static architecture tests enforce no cross-domain imports.
- A merged PR clears the displayed PR and records its exact URL in merged history.
- A later distinct PR becomes the displayed active PR.
- Merge detection adds the exact reminder context and does not complete Todoist tasks.
- Existing tests are updated or replaced to reflect intentional removal of combined state/tool compatibility.
