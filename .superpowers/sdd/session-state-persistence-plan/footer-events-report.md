# Footer event refactor report

## Scope

- Removed shared `footerUpdateEvent` and `worktreeStatusEvent` channels and dead publishers/subscribers.
- PR, Todoist, and Worktree now update footer through `moduleStateChangedEvent` only.
- Herdr claim progress now publishes `{ claimInProgress }` on Herdr module state with `persist: false`; descriptor strips transient progress while preserving successful-claim marker.
- Footer consumer derives PR, Todoist, Worktree dirty marker, and Herdr working status from module-state updates.

## Changed files

- `src/shared/events.ts`
- `src/shared/session-state.ts`
- `src/shared/constants.ts`
- `src/footer/constants.ts`
- `src/footer/events.ts`
- `src/footer/event-consumers.ts`
- `src/footer/module.ts`
- `src/herdr/constants.ts`
- `src/herdr/events.ts`
- `src/herdr/event-consumers.ts`
- `src/herdr/notifications.ts`
- `src/herdr/state.ts`
- `src/main.ts`
- `src/pr/module.ts`
- `src/pr/state.ts`
- `src/pr/state-tool.ts`
- `src/todoist/completion.ts`
- `src/todoist/event-consumers.ts`
- `src/todoist/module.ts`
- `src/todoist/state.ts`
- `src/worktree/event-consumers.ts`
- `src/worktree/event-publishers.ts`
- `test/events.test.ts`
- `test/extension-session.test.ts`
- `test/footer/module.test.ts`
- `test/herdr/tab-claim.test.ts`
- `test/pr/state-tool.test.ts`
- `test/todoist/module.test.ts`
- `test/worktree/module.test.ts`

## TDD evidence

Red phase command:

```text
env -u PI_SUBAGENT_CHILD npx vitest run test/events.test.ts test/footer/module.test.ts test/herdr/tab-claim.test.ts test/worktree/module.test.ts test/pr/state-tool.test.ts test/todoist/module.test.ts test/extension-session.test.ts
```

Observed expected failures before production implementation included:

```text
TypeError: Cannot read properties of undefined (reading 'subscribe')
TypeError: dependencies.refreshFooterStatuses is not a function
TypeError: Cannot read properties of undefined (reading 'emit')
AssertionError: expected { claimInProgress: true } to deeply equal {}
```

Green focused command:

```text
env -u PI_SUBAGENT_CHILD npx vitest run test/events.test.ts test/footer/module.test.ts test/herdr/tab-claim.test.ts test/worktree/module.test.ts test/pr/state-tool.test.ts test/todoist/module.test.ts test/extension-session.test.ts
```

```text
Test Files  7 passed (7)
Tests  58 passed (58)
```

Focused tests added/updated:

- Shared event shape rejects removed footer channels.
- Footer derives statuses from PR, Todoist, dirty Git patch, and Herdr module updates.
- Herdr transient claim callback emits false/true/false lifecycle states.
- Herdr serializer/restorer excludes transient claim progress.
- Removed obsolete footer fixture dependencies and worktree footer-channel assertions.

## Full validation output

`env -u PI_SUBAGENT_CHILD npm test`:

```text
✔ no dependency violations found (199 modules, 757 dependencies cruised)
Test Files  56 passed (56)
Tests  358 passed | 8 skipped (366)
```

`npm run lint`:

```text
Checked 181 files in 37ms. No fixes applied.
```

`npm run typecheck`:

```text
(no output after tsc command; passed)
```

`git diff --check`:

```text
(passed; no whitespace errors)
```

`git status --short --branch` before commit:

```text
## cleanup-root-files...origin/cleanup-root-files
 M src/footer/constants.ts
 M src/footer/event-consumers.ts
 M src/footer/events.ts
 M src/footer/module.ts
 M src/herdr/constants.ts
 M src/herdr/event-consumers.ts
 M src/herdr/events.ts
 M src/herdr/notifications.ts
 M src/herdr/state.ts
 M src/main.ts
 M src/pr/module.ts
 M src/pr/state-tool.ts
 M src/pr/state.ts
 M src/shared/constants.ts
 M src/shared/events.ts
 M src/shared/session-state.ts
 M src/todoist/completion.ts
 M src/todoist/event-consumers.ts
 M src/todoist/module.ts
 M src/todoist/state.ts
 M src/worktree/event-consumers.ts
 M src/worktree/event-publishers.ts
 M test/events.test.ts
 M test/extension-session.test.ts
 M test/footer/module.test.ts
 M test/herdr/tab-claim.test.ts
 M test/pr/state-tool.test.ts
 M test/todoist/module.test.ts
 M test/worktree/module.test.ts
```

## Residual concerns

- Extension tests require `PI_SUBAGENT_CHILD` unset because production intentionally skips extension installation in child processes.
- Existing eight skipped tests unchanged.
- Footer module `update` remains internal rendering/state publication API; no module uses it as a cross-module event channel.

## Post-commit validation

Commit `51e7d90 refactor: route footer status through module state`.

Command:

```text
env -u PI_SUBAGENT_CHILD npm test && npm run lint && npm run typecheck && git diff --check && git status --short --branch
```

Output:

```text
✔ no dependency violations found (199 modules, 757 dependencies cruised)
Test Files  56 passed (56)
Tests  358 passed | 8 skipped (366)
Checked 181 files in 35ms. No fixes applied.
## cleanup-root-files...origin/cleanup-root-files [ahead 1]
```

No staged or unstaged files remain after commit.
