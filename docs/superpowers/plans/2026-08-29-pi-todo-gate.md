# Pi Todo Gate Implementation Plan

## Status

Superseded by current implementation. This plan originally included Pi-task plugin synchronization; that scope was removed.

## Current Implementation Update

`pi-todo-gate` now handles only:

- project-scoped PR and Todoist task linking;
- Todoist parent-task claiming and merge completion;
- session state, footer status, and worktree PR guidance;
- non-blocking Herdr tab naming through separate integration.

Pi-task plugin integration is not part of current code. Do not implement or restore Pi↔Todoist descendant synchronization.

Removed from implementation:

- Pi-task store readers and writers;
- `.pi/tasks` path handling;
- Pi↔Todoist task conversion;
- TaskCreate/TaskUpdate/TaskStop/TaskExecute synchronization hooks;
- scheduled inbound or outbound task synchronization;
- Todoist descendant deletion and recreation.

See current design: `docs/superpowers/specs/2026-08-29-pi-todo-gate-design.md`.

## Verification

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```
