# Exit Protocol Design

## Goal

Add event-driven exit handling to `pi-todo-gate` so merged sessions and real Pi exits can offer one combined, preselected cleanup prompt. Active Todoist tasks can be completed; linked worktrees can be cleaned up safely. Modules communicate through shared typed events, never direct module references.

## Scope

- Add typed shared event dispatch and action collection.
- Add an exit-protocol presenter with combined checkbox UI.
- Add worktree lifecycle tracking and local cleanup.
- Convert PR merge notification from direct Todoist coupling to `prMerged` event dispatch.
- Convert Todoist merge completion handling to event-provided actions.
- Preserve remote branches.
- Do not clean up during session replacement, reload, fork, or other non-quit shutdowns.

## Shared events

`src/shared/events.ts` will expose a typed asynchronous event bus. Supported events:

- `prMerged`: carries merged PR URL and action collector.
- `sessionWillClose`: carries shutdown reason and action collector.

Action providers register `ExitAction` values with the event payload. Actions contain stable IDs, display labels, and async execution callbacks. Event dispatch awaits listeners in deterministic order and isolates listener failures so one module cannot prevent another module from contributing or handling actions.

The extension creates one bus per extension runtime and passes it to modules. This avoids direct PR-to-Todoist or extension-to-module calls while keeping event behavior testable. Event payloads carry plain lifecycle data and action registrations, not stale session contexts.

## Lifecycle

### Merge

1. PR module detects and records a merge.
2. PR module emits `prMerged`.
3. Active Todoist and worktree modules register applicable actions.
4. Exit-protocol module presents one combined action picker.
5. All applicable actions start selected and focus starts on `Submit`.
6. Todoist completion executes immediately when selected.
7. Worktree cleanup selection records approval only; physical deletion is deferred until shutdown.
8. Cancel or deselecting an action leaves it available for a later close prompt.

Existing Todoist merge-specific prompt moves to this shared protocol. This prevents duplicate prompts while retaining current task completion and state-clearing behavior.

### Session close

The extension emits `sessionWillClose` before deactivating session modules. The protocol handles destructive work only for `reason === "quit"`; `/new`, `/resume`, `/fork`, and `/reload` do not remove worktrees or complete tasks.

The close event collects remaining Todoist and worktree actions, including previously approved deferred cleanup. The combined picker again starts with all applicable actions selected and focus on `Submit`.

If no actions exist, no picker is shown.

## Prompt UI

In TUI mode, use a custom component based on existing `SettingsList` patterns. It displays only context-valid actions:

- `Mark Todoist task "<task name>" complete`
- `Delete worktree "<path>" and local branch "<branch>"`

The `Submit` control is focused by default. Users can navigate to rare exceptions, toggle an action, return to `Submit`, and press Enter. Cancel preserves all actions. Deselecting all actions performs nothing.

In RPC mode, where custom TUI components are unavailable, use sequential confirmations for each applicable action. In JSON/print modes (`hasUI === false`), skip prompts and destructive actions; notify only when appropriate.

## Worktree module

`src/worktree/module.ts` tracks linked-worktree state for the current session:

- current worktree path;
- local branch name;
- project/main checkout root;
- initial `HEAD` SHA;
- initial `git status --porcelain=v1 --untracked-files=all` snapshot.

At `session_start`, Git lookup failures leave the module inert. At close, it compares current Git state with the baseline.

A worktree is considered to have no session work only when:

- initial and current status snapshots are empty;
- initial and current `HEAD` SHAs match.

Any staged, unstaged, untracked, or committed change counts as work. An uncertain lookup follows the normal prompt path rather than auto-deleting.

For a no-work linked worktree at quit:

1. Delete it immediately during `sessionWillClose` without adding a cleanup action.
2. Change Node process cwd to the project root before Git removal.
3. Run local worktree removal and local branch deletion.
4. Notify `Worktree deleted because no changes were made`.
5. Continue collecting an independent Todoist completion action, if one exists.

For a worktree with changes, the module contributes the cleanup action. On Submit, it checks `git status` again. If dirty, it asks for confirmation before force removal. If confirmed, it changes process cwd to the project root, runs `git worktree remove` and deletes the local branch. Remote branches are never changed. Failures notify the user and leave cleanup eligible for retry during a later close event.

Changing process cwd is required before removal, but does not change Pi's captured `ctx.cwd`; therefore all physical worktree removal is deferred until session shutdown.

## Todoist module

Todoist remains owner of task state, API client, status rendering, persistence, and task completion. It subscribes to both shared events and contributes a completion action only when an active task exists.

Executing the action calls the existing completion API, clears task state, refreshes status, and notifies success. Failures retain task state and notify a sanitized error. If no-work worktree auto-cleanup occurs, an active Todoist task still contributes its own action and remains independently selectable.

## PR module and extension integration

PR module no longer invokes Todoist behavior directly. Its merge event is forwarded through the shared bus. Extension shutdown emits `sessionWillClose` before calling `deactivate()` on PR, Todoist, and worktree modules.

Generation/session guards prevent stale asynchronous merge or shutdown work from acting on a replacement session. Event listeners unsubscribe or become inert on deactivation.

## Error handling and safety

- Git inspection failures never trigger automatic deletion.
- Dirty worktree removal always requires explicit confirmation.
- User cancellation and deselection preserve state.
- Local branch deletion happens only after worktree removal is attempted and never deletes remote refs.
- Task completion and worktree cleanup are independent; one failure does not block the other.
- Notifications are best effort and sanitized where external command errors may contain secrets.

## Tests

Add focused tests covering:

- typed event dispatch and action collection;
- combined action labels and all-selected/default-Submit behavior;
- RPC and no-UI fallbacks;
- PR merge event delivery without direct Todoist calls;
- Todoist action contribution, completion, failure, and retry state;
- worktree baseline capture and no-work detection;
- automatic no-work deletion and notification;
- independent Todoist prompt after no-work deletion;
- deferred cleanup after merge;
- dirty cleanup confirmation and refusal;
- local branch deletion and remote-branch preservation;
- non-quit shutdown suppression;
- stale session/deactivation isolation.

Run `npm test`, `npm run typecheck`, and `npm run lint` before completion.
