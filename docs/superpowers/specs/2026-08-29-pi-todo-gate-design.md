# Pi Todo Gate Design

## Status

Superseded historical design. Current implementation retains PR/task linking and merge completion, but removes all Pi-task plugin synchronization.

## Current Scope

Connect one coding session to one GitHub pull request and one Todoist task. Keep links visible, preserve them across session handoff, claim Todoist tasks, and complete the active task after its associated PR merges.

The extension is session-scoped and project-scoped. It does not create global ownership or activate for unrelated repositories.

## Activation and Configuration

Configuration is loaded from `~/.pi/agent/pi-todo-gate.json`.

Rules:

1. Resolve `ctx.cwd` and walk toward filesystem root.
2. Select nearest configured ancestor.
3. Map configured value to Todoist project name or `id:<id>`.
4. Unmatched projects remain inert: no tools, footer, prompt injection, PR detection, Git calls, or Todoist calls.
5. Herdr tab naming has separate activation and remains non-blocking.

## Session State

State is stored in Pi custom entries:

```ts
type WorkState = {
  prUrl?: string;
  taskUrl?: string;
  taskRef?: string;
  inheritedFrom?: string;
  mergeCompletedAt?: string;
  todoistCompletionAttemptedAt?: string;
};
```

Latest current-session state wins. When no current state exists, same-project previous-session state may be inherited. Explicit clearing prevents old state from reactivating.

## Pull Request Tracking

Recognized GitHub PR URLs use:

```text
https://github.com/<owner>/<repo>/pull/<number>
```

Automatic discovery scans session history oldest-to-newest and preserves first valid URL. Explicit `set_pr` overrides discovery. `clear_pr` removes only PR state.

## Todoist Task Claiming

`set_task` accepts a Todoist URL, ID, or resolvable reference. It:

1. Resolves configured Todoist project.
2. Views requested task.
3. Rejects tasks outside configured project.
4. Rejects tasks already in `In Progress` when owned by another task/session.
5. Moves valid task to `In Progress`.
6. Stores canonical task URL and reference.

Inferred task linking uses the same claim operation when session evidence identifies a claimed task. Missing-task warning is guidance only and never blocks work.

Task actions and merge completion use a per-session FIFO operation queue. Each queued operation runs after prior remote work returns. Queue failures do not poison later operations. State writes verify active session and work identity before committing.

## Merge Completion

Successful Bash results are inspected for verified merge commands matching the pinned PR. On verified merge:

1. Run `td task complete <taskRef>`.
2. Record completion attempt/idempotency state.
3. Notify success or failure.
4. Keep PR/task links pinned until explicitly changed.

Repeated and stale merge events do not overwrite newer task/PR state.

## Removed Pi Task Synchronization

Pi-task plugin integration and Pi↔Todoist descendant synchronization are removed from current implementation. The extension does not:

- import or depend on `@tintinweb/pi-tasks`;
- read or write `.pi/tasks` files;
- listen for `TaskCreate`, `TaskUpdate`, `TaskStop`, or `TaskExecute` events;
- schedule inbound or outbound descendant synchronization;
- delete or recreate Todoist subtasks;
- refresh Pi task lists on task claim or session start.

Removed modules include `src/pi-tasks-sync.ts`, `src/pi-task-store.ts`, `src/pi-task-normalize.ts`, and `src/pi-tasks-sync-helpers.ts`, together with their tests.

Todoist task claims affect only the parent task's section and session link. Existing Todoist subtasks remain untouched.

## Worktree PR Guidance

The extension uses Git worktree and branch inspection to provide guidance after meaningful work when the active branch has no open PR. It never pushes or creates PRs automatically.

## Footer

Interactive TUI shows clickable PR/task links and preserves existing extension statuses. Headless modes use notifications and hidden context only.

## Error and Safety Rules

- Invoke `git`, `gh`, and `td` with argument arrays.
- Treat CLI output as untrusted.
- Missing binaries/authentication produce diagnostics.
- Inactive projects perform no external calls.
- Herdr worker output never enters main-session context.

## Verification

Required checks:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```

Current tests cover project activation, state inheritance, Todoist claim validation, merge completion, FIFO operation ordering, Herdr tab naming, and stale async protection.
