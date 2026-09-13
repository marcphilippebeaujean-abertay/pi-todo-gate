# Task 8 Report: Final Architecture and Behavior Gate

## Whole-branch review fixes

- Removed duplicate factory overload declarations from Worktree, Todoist, Footer, and Exit Protocol modules.
- Removed root `getSession`/`setSession` callbacks and closures. Root owns stable `session` composition field; typed activation payload carries current SessionRecord and lifecycle epoch.
- Removed named runtime compatibility bundles (`TodoistRuntime`, `PrRuntime`, `StateToolRuntime`) and Todoist `.runtime()` factory; module-owned operation dependencies remain narrow and direct.
- PR module no longer emits Todoist-owned `mergeCompletedAt` or `todoistCompletionAttemptedAt` fields. Todoist owns those projection fields; legacy WorkState persistence remains compatible.
- PR tool-result merge path validates current session/context before and after async Git inspection, retaining operation-generation guards.
- PR deactivation clears PR facet state while preserving generation barrier; known-origin startup cannot inherit stale merged metadata.
- Production wiring registers Todoist merge consumer before constructing Exit Protocol, making `prMergedEvent` subscriber order deterministic. Added production-wiring regression coverage.
- Added lifecycle epoch/session guards to Worktree, PR, Todoist, and Exit Protocol activation. Shutdown during awaited Worktree inspection cannot reactivate stale module state or prompts. Added shutdown-during-activation regression coverage.
- Todoist claim reset now occurs only after activation session/context/epoch guards pass. Added regression coverage proving stale activation cannot clear newer claim state.
- Preserved one `prMergedEvent`, typed `Event<T>`, native tool-result bridge, direct awaited Exit Protocol → Worktree action, stable SessionState snapshots, Worktree/Footer ownership, deleted `src/application`, and lint boundary.

## Structural review

- No `src/application/`.
- No forbidden runtime/context adapters, `shared/prompt-queue`, `setupListener`, WeakMap epoch adapter, root session callback adapters, or aggregate `work` module projection.
- Custom event `.on(...)` calls absent; remaining `.on(...)` calls are native PI or Node stream APIs.
- `ExtensionState` production usage limited to `src/main.ts` plus declaration in `src/state.ts`.
- Shared `Event<T>` primitive and one `prMergedEvent` channel validated.

## Validation

- `env -u PI_SUBAGENT_CHILD npm test` — passed; 51 files, 314 passed, 8 skipped.
- `npm run architecture` — passed; dependency cruiser: 189 modules / 686 dependencies, structure and production checks clean.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- Targeted production wiring, shutdown race, Todoist stale-activation, PR, Worktree, and extension tests — passed.
- Targeted `rg` checks — no forbidden identifiers/adapters, no custom event `.on()` calls, no WeakMap, no root callback injection, no aggregate work projection.

## Commit

Pending final commit.

## Residual risks

- Native PI and Node stream `.on(...)` calls remain intentionally because they are external APIs, not module event channels.
- Previously skipped stale claim/completion race tests remain skipped because they require broader fixture repair; no failures hidden.
