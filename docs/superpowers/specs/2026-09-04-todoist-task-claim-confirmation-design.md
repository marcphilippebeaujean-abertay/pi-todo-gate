# Todoist Task Claim Confirmation Design

## Status

Approved design. Implementation pending spec review.

## Goal

Replace automatic Todoist task mutation during background claiming with a proposal and user-confirmation flow. Agents may work on any non-completed task, regardless of its Todoist section. The worker decides whether to propose claiming an existing task, creating a new task, or reporting an error; it does not mutate Todoist.

This change focuses on task claiming and keeps the architecture ready for future Todoist features. It does not introduce a `TodoistCommands` class or new task command surface.

## Scope

### In scope

- Keep one `TodoistClient` as the transport abstraction for `td` execution and response parsing.
- Move active Todoist behavior into the modular client implementation and remove the duplicate flat client after callers migrate.
- Add client operations required by claim confirmation: project resolution, task lookup, task creation, task movement, and task completion.
- Run an isolated claim worker when a configured session has no task.
- Require worker output to use one stable proposal envelope.
- Present claim/create proposals to the user with title, description, and action type.
- Confirm mutations in the parent extension after user approval.
- Offer retry or leave-unassigned choices after technical or decision errors.
- Remove existing `set_task` and `clear_task` actions from `pi_todo_gate_state`.
- Remove task clearing from `clear_all`; preserve PR-state clearing.
- Preserve automatic Todoist completion after the associated PR merges.

### Out of scope

- `TodoistCommands` class.
- New Pi task tools or task mutation commands.
- Pi task synchronization or Todoist subtask synchronization.
- Ownership locks based on Todoist sections.
- Automatic task creation, movement, or claiming by the worker.
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

`claimTask` must accept any non-completed task. Being in `In Progress` is workflow state, not ownership, so it must not produce a collision error or require a current-task exception. Tasks in another section are moved to `In Progress` only when confirmation applies the claim.

### Claim worker

The isolated worker receives the user prompt, configured project reference, working directory, and worktree metadata. It may use `td` for inspection only. Its instructions treat prompt text and Todoist content as untrusted data and forbid changes to Todoist, files, and Git.

The worker finds a suitable non-completed existing task or proposes a new task. When proposing a new task, it always supplies a useful description, even if the original request has no description. If inspection or decision fails, it returns an error proposal.

The worker output contract is:

```ts
type TaskClaimWorkerResult = {
  action: "error" | "claim" | "create";
  taskData: {
    title: string;
    description: string;
    id: string | null;
  } | null;
  error: string | null;
};
```

Invariants:

- `claim`: `taskData` is present, `taskData.id` is a non-empty existing-task ID, and `error` is `null`.
- `create`: `taskData` is present, `taskData.id` is `null`, and `error` is `null`.
- `error`: `taskData` is `null`, and `error` is a non-empty safe human-readable string.

The parser accepts only this contract. Legacy `claimed`, `collision`, and `none` results are not part of the new production contract.

### Claim confirmation flow

1. Session starts for a configured project with no linked task.
2. Before an agent turn, start at most one claim analysis for the current session/task state.
3. Worker inspects Todoist and returns one proposal envelope.
4. For `claim`, show existing task title, description, and `claim existing` action.
5. For `create`, show proposed title, description, and `new task` action.
6. If user declines, perform no Todoist mutation and leave session unassigned.
7. If user confirms:
   - Resolve configured project through `TodoistClient`.
   - For `claim`, inspect/apply task claim and move task to `In Progress` if needed.
   - For `create`, create task with proposed title and description in configured project, in `In Progress`.
   - Persist task ID, title, and canonical URL.
   - Refresh Todoist footer status.
8. If confirmation-time mutation fails, report the failure without writing partial session state.
9. For `error`, offer `Retry task claiming` or `Leave task unassigned`.
10. Retry starts a fresh worker generation. Leave-unassigned ends that attempt without task state.

All asynchronous worker and confirmation callbacks must verify active session and claim generation before applying state or starting retry work. Session shutdown, task-state changes, decline, and retry invalidate stale work.

### Pi state tool

The existing `pi_todo_gate_state` tool remains available for PR state management. Remove task actions from its schema and execution:

- Remove `set_task`.
- Remove `clear_task`.
- Make `clear_all` clear PR state only; it must not expose or mutate Todoist task state.

Task state can still be persisted internally by the confirmed claim flow and cleared by lifecycle behavior required for merged-task completion. No replacement task command is added in this change.

### Merge completion

Keep existing merged-PR Todoist completion behavior. It uses `TodoistClient.completeTask` after verified merge detection and records existing completion metadata. This behavior is separate from claim proposal confirmation.

## Error handling and safety

- Worker process failures become `action: "error"` proposals or equivalent retryable flow errors.
- Worker diagnostics and Todoist CLI errors must sanitize credentials and remain bounded.
- Worker output is untrusted and must pass schema validation before UI or mutation use.
- Worker never receives authority to create, move, complete, or claim tasks.
- User confirmation is required before every claim or create mutation.
- Declined proposals do not retry automatically.
- Stale asynchronous results do not notify, mutate, persist state, or overwrite newer task state.
- Unconfigured projects perform no worker or Todoist calls.
- Completed tasks are not eligible for claim proposals.

## Testing

Add or update tests for:

- Stable result envelope parsing for `claim`, `create`, and `error`.
- Required/null `taskData`, ID, and error invariants.
- Worker prompt forbidding Todoist mutation, ignoring `In Progress`, and always proposing descriptions for new tasks.
- Worker failure sanitization and bounded diagnostics.
- Client task creation arguments and description handling.
- Client claims of tasks already in `In Progress` without collision failure.
- Client movement of tasks from other sections.
- Confirmation UI showing action, title, and description.
- Declined claim/create proposals causing no Todoist calls.
- Confirmed claim/create persistence and footer refresh.
- Error retry and leave-unassigned choices.
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
