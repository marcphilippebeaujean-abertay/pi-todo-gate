# Todoist Task Claim Worker Design

## Status

Approved design. Background worker owns claim mutation.

## Goal

Run background Todoist claiming without an interactive confirmation prompt. Agents may work on any non-completed task, regardless of its Todoist section. The worker claims an existing task or creates and claims a new task; only missing claim evidence or an error produces a warning.

This change focuses on task claiming and keeps the architecture ready for future Todoist features. It does not introduce a `TodoistCommands` class or new task command surface.

## Scope

### In scope

- Keep one `TodoistClient` as the transport abstraction for `td` execution and response parsing.
- Move active Todoist behavior into the modular client implementation and remove the duplicate flat client after callers migrate.
- Keep client operations required by completion: task completion and safe Todoist parsing.
- Run an isolated claim worker when a configured session has no task.
- Pass current session ID and available PR reference to the worker.
- Require worker output to use one stable claim-result envelope.
- Let the worker inspect, create, move, and claim tasks without a parent confirmation prompt.
- Raise generic warnings after worker errors or missing claim evidence.
- Remove existing `set_task` and `clear_task` actions from `pi_todo_gate_state`.
- Remove task clearing from `clear_all`; preserve PR-state clearing.
- Preserve automatic Todoist completion after the associated PR merges.

### Out of scope

- `TodoistCommands` class.
- New Pi task tools or task mutation commands.
- Pi task synchronization or Todoist subtask synchronization.
- Ownership locks based on Todoist sections.
- Todoist user-assignee mutation; “assign to himself” means existing claim behavior.
- Changes to PR tracking unrelated to task-state cleanup.

## Architecture

### TodoistClient

`TodoistClient` is the only Todoist transport boundary. It owns:

- `td` process execution through an injected command executor.
- Argument construction and JSON/text response parsing.
- Safe error conversion and diagnostic sanitization.
- Project resolution.
- Task lookup.
- Task creation.
- Task movement to `In Progress`.
- Task completion.

It does not own session state, UI, prompts, worker lifecycle, or user decisions.

The existing active client in `src/todoist.ts` and the modular duplicate in `src/todoist/client.ts` must converge on `src/todoist/client.ts`. After imports migrate, delete `src/todoist.ts` and update tests. No production import may retain the flat implementation.

`claimTask` must accept any non-completed task. Being in `In Progress` is workflow state, not ownership, so it must not produce a collision error or require a current-task exception. Tasks in another section are moved to `In Progress` while the worker applies the claim.

### Claim worker

The isolated worker receives the user prompt, configured project reference, PR reference when available, session ID, working directory, and worktree metadata. Its instructions treat prompt text and Todoist content as untrusted data, forbid file and Git changes, and authorize only the Todoist mutations needed to complete the claim.

The worker finds a suitable non-completed existing task or creates a new task with a useful description. It ignores `In Progress` as an ownership collision. After successful claim/create/move work, it returns claim evidence. If inspection or mutation fails, it returns an error result.

The worker output contract is:

```ts
type TaskClaimWorkerResult = {
  sessionId: string;
  action: "error" | "claim";
  taskData: {
    title: string;
    description: string;
    id: string;
  } | null;
  error: string | null;
};
```

Invariants:

- `claim`: `sessionId` matches the dispatching session, `taskData` is present with a non-empty claimed-task ID, and `error` is `null`.
- `error`: `sessionId` identifies the dispatching session, `taskData` is `null`, and `error` is a non-empty safe human-readable string.

The parser accepts only this contract. Legacy `claimed`, `collision`, and `none` results are not part of the new production contract.

### Background claim flow

1. Session starts for a configured project with no linked task.
2. Before an agent turn, start at most one claim analysis for the current session/task state.
3. Worker receives session ID and current PR reference, then inspects and mutates Todoist to complete the claim.
4. Worker returns claim evidence only after successful existing-task claim or new-task creation and claim.
5. Parent validates session ID and generation, persists task ID, title, and canonical URL, then refreshes Todoist footer status.
6. Missing claim evidence or worker failure becomes a generic warning; no parent retry prompt is shown.

All asynchronous worker and confirmation callbacks must verify active session and claim generation before applying state or starting retry work. Session shutdown, task-state changes, decline, and retry invalidate stale work.

### Pi state tool

The existing `pi_todo_gate_state` tool remains available for PR state management. Remove task actions from its schema and execution:

- Remove `set_task`.
- Remove `clear_task`.
- Make `clear_all` clear PR state only; it must not expose or mutate Todoist task state.

Task state can still be persisted internally by the background claim flow and cleared by lifecycle behavior required for merged-task completion. No replacement task command is added in this change.

### Merge completion

Keep existing merged-PR Todoist completion behavior. It uses `TodoistClient.completeTask` after verified merge detection and records existing completion metadata. This behavior is separate from claim proposal confirmation.

## Error handling and safety

- Worker process failures become `action: "error"` results and generic warnings.
- Worker diagnostics and Todoist CLI errors must sanitize credentials and remain bounded.
- Worker output is untrusted and must pass schema validation before session persistence.
- Worker receives authority only for Todoist mutations required by its claim job; it cannot modify files or Git.
- Generic warning handling templates `JobType` as `Herdr` or `Todoist`.
- Stale asynchronous results do not notify, mutate, persist state, or overwrite newer task state; session ID and generation must both match.
- Unconfigured projects perform no worker or Todoist calls.
- Completed tasks are not eligible for claim proposals.

## Testing

Add or update tests for:

- Stable result envelope parsing for `claim` and `error`, including session ID.
- Required task ID and error invariants.
- Worker prompt authorizing Todoist claim mutations, ignoring `In Progress`, and requiring descriptions for new tasks.
- PR reference passed to the worker when available.
- Generic warning formatting for Herdr and Todoist job types.
- Worker failure sanitization and bounded diagnostics.
- Client task creation arguments and description handling.
- Client claims of tasks already in `In Progress` without collision failure.
- Client movement of tasks from other sections.
- No claim confirmation UI or retry/leave-unassigned prompt.
- Completed worker claim evidence persists state and refreshes footer.
- Worker errors and missing evidence raise warnings without parent mutation.
- Stale worker, retry, confirmation, and shutdown results.
- Removed `set_task` and `clear_task` schema/actions.
- `clear_all` preserving PR clearing without task mutation.
- Existing merged-PR task completion behavior.

Required verification:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```
