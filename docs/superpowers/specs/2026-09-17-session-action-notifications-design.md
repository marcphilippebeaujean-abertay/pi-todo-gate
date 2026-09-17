# Session Action Notifications Design

## Goal

Reduce repeated session-identity checks in background jobs while preserving protection at irreversible mutation boundaries and informing the active session when a session transition affects an action.

## Decisions

- Keep `activeSessionId` as in-memory runtime concurrency state. It is not serialized in persisted extension state. Keep `inheritedFromSessionId` because it carries handoff provenance across session files and serves a different purpose.
- Add one shared notification event carrying only:
  - `message: string`
  - `level: "info" | "warning"`
- Route notifications centrally to the currently active session. Do not pass the originating `ExtensionContext`, since it belongs to the old session.
- If no active session context exists during reset/activation transition, queue notification by current runtime session ID and flush it when matching session activation completes. Drop notices when there is no active session or on shutdown.
- Add a shared session-action wrapper for irreversible dispatch. It checks session validity immediately before invoking the mutation callback and emits the supplied warning notification when it skips a stale action.
- Keep only the post-action checks required to prevent stale asynchronous work from writing shared state. Do not cancel or classify an already-dispatched external command as failed solely because session changed.
- Read-only discovery and status jobs may continue without repeated session checks; sequence checks remain where needed to reject out-of-order refresh results.

## Mutation boundaries

Use the wrapper at:

- Todoist task completion dispatch.
- Worktree removal dispatch.
- Local branch deletion dispatch.

For multi-step worktree cleanup, guard each external mutation separately so branch deletion cannot start after a session transition following worktree removal. Partial completion remains possible and must be reported using existing cleanup results plus notification where appropriate.

## Notification flow

1. Background operation reaches mutation boundary.
2. Wrapper checks its captured session validity.
3. If stale, callback is not invoked and wrapper publishes the caller-supplied message/warning event.
4. If mutation starts, it runs to its natural result; no false cancellation is inferred.
5. If session changed while it ran, callers skip stale shared-state writes and publish an appropriate result notification.
6. Root notification consumer immediately notifies `root.session` when available, otherwise queues for matching activation.

The event is an internal extension event, not persisted session state and not a new Pi lifecycle event. UI notification informs the user; where agent awareness is required, the next `before_agent_start` message can consume the same pending notice.

## Non-goals

- Blocking new sessions or shutdown until workers return.
- Guaranteeing cancellation or rollback after an external process has started.
- Removing all runtime session identity tracking.
- Persisting transient notification events across Pi process termination.

## Testing

Add/update tests for:

- Notification routing to current session context, never stale origin context.
- Queue and flush across activation gap; discard without active session and on shutdown.
- Stale mutation skipped before callback and notification emitted.
- Mutation that starts before transition is not falsely reported as unstarted/failed.
- Worktree per-command guards, including partial cleanup.
- Read-only work continuing while session identity changes.
- Existing lifecycle, state-persistence, and stale-state protections remaining green.
