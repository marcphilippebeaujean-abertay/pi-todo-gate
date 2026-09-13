# Task 8 Report: Final Architecture and Behavior Gate

## Whole-branch review fixes

- Removed duplicate factory overload declarations from Worktree, Todoist, Footer, and Exit Protocol modules.
- Removed root `getSession`/`setSession` callbacks and closures. Root now owns stable `session` composition field; activation payload carries current SessionRecord to modules.
- Removed remaining named runtime compatibility bundles (`TodoistRuntime`, `PrRuntime`, `StateToolRuntime`) and Todoist `.runtime()` factory; module-owned operation dependencies remain narrow and direct.
- PR module no longer emits Todoist-owned `mergeCompletedAt` or `todoistCompletionAttemptedAt` fields. Todoist owns those projection fields; legacy WorkState persistence remains compatible.
- PR tool-result merge path now validates current session/context both before and after async Git inspection, retaining operation-generation guards.
- PR deactivation clears PR facet state while preserving generation barrier; known-origin startup cannot inherit stale merged metadata.
- Deterministic production subscriber order keeps Todoist merge completion consumer before Exit Protocol prompt registration.
- Added root callback-adapter architecture assertion and Todoist-owned projection regression coverage.
- Preserved one `prMergedEvent`, typed `Event<T>`, native tool-result bridge, direct awaited Exit Protocol → Worktree action, stable SessionState snapshots, Worktree/Footer ownership, deleted `src/application`, and lint boundary.

## Structural review

- No `src/application/`.
- No forbidden runtime/context adapters, `shared/prompt-queue`, `setupListener`, WeakMap epoch adapter, root session callback adapters, or aggregate `work` module projection.
- Custom event `.on(...)` calls absent; remaining `.on(...)` calls are native PI or Node stream APIs.
- `ExtensionState` production usage limited to `src/main.ts` plus declaration in `src/state.ts`.
- Shared `Event<T>` primitive and one `prMergedEvent` channel validated.

## Validation

- `env -u PI_SUBAGENT_CHILD npm test` — passed; 51 files, 311 passed, 8 skipped.
- `npm run architecture` — passed; dependency cruiser: 189 modules / 684 dependencies, structure and production checks clean.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- Targeted PR, lifecycle, Todoist projection, and extension tests — passed.
- Targeted `rg` checks — no forbidden identifiers/adapters, no custom event `.on()` calls, no WeakMap, no root lifecycle direct calls, no aggregate work projection.

## Commit

Pending final commit: `refactor: complete extension state architecture`

## Residual risks

- Native PI and Node stream `.on(...)` calls remain intentionally because they are external APIs, not module event channels.
- Existing asynchronous claim-proposal assertions can intermittently flake under parallel Vitest scheduling; repeated full run passed.
- Previously skipped stale claim/completion race tests remain skipped because they require broader fixture repair; no failures hidden.
