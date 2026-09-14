# Final Fix Wave Report

## Scope

Closed final review findings for module-state boundaries without resetting or discarding existing commits.

## Fixes

1. **Todoist completion dependency boundary**
   - `TodoistModuleImpl.operations()` now builds typed `TodoistOperations` with precise `dependencies` values (`exec`, task-claim worker, and Todoist client factory).
   - Completion lookup uses optional dependency access, so legacy adapters without a dependency bag fail over to default client execution instead of throwing while dereferencing `undefined`.
   - Added `createTodoistModule` integration coverage that activates a configured session and completes its merged task using default module dependency wiring.

2. **Herdr stale worker result isolation**
   - Worker requests and worker result events carry lifecycle epoch when available.
   - Attempts validate both attempt ID and epoch before clearing worker state, renaming/moving tabs, and publishing claim state.
   - Attempt sequence remains globally monotonic across shutdown/session boundaries. Per-session retry count is tracked separately, preventing old-session results from matching a newly reused attempt ID.
   - Added late old-session result regression coverage.

3. **Public module entrypoint boundaries**
   - Removed wildcard exports for implementation facets from PR, Todoist, Herdr, and Exit Protocol module entrypoints.
   - Kept module-state exports and factory/setup APIs; retained explicit PR merge registration and Todoist client/error capabilities.
   - Migrated tests that exercised implementation facets to direct internal facet imports.
   - Added export-surface test preventing forbidden implementation wildcard exports.

4. **Todoist injected configuration validation**
   - Injected unknown configuration is normalized through `parseProjectEntry` for every project entry.
   - Invalid root values and malformed null, numeric, array, or object entries are ignored safely; valid entries remain usable.
   - Added malformed-entry coverage.
   - Moved Todoist config facade imports from module entrypoint to parser implementation after export restriction.

5. **Unnecessary casts**
   - `createPrModule` and `createWorktreeModule` now return structurally compatible values directly, removing unnecessary `as unknown as` casts.

## Validation

- Targeted regressions: passed (`Todoist module`, Todoist merge integration, Herdr claim worker/tab claim, module API boundaries).
- `npm test`: passed — 59 files, 393 passed, 8 skipped.
- `npm run lint`: passed — Biome and strict lint.
- `npm run typecheck`: passed.
- `npm run architecture`: passed — no dependency violations.
- `git diff --check`: passed.

## Residual concerns

- Worker event epoch fields remain optional for compatibility with direct legacy worker adapters; production-created workers always receive the current epoch, and monotonic IDs provide the cross-session safety invariant.
- Existing branch commits remain intact; final fix wave is contained in single follow-up commit (`fix: close final module boundary review findings`); final commit hash is reported with this artifact handoff.
