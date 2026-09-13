# Task 7 Report: Enforce Root-State Import Boundary

## Implementation

- Renamed rule ID to `no-root-state-imports-in-modules`.
- Rule resolves each scoped-module import with TypeScript module resolution, then checks whether resolved target is root `src/state.ts`.
- Scoped directories covered: `pr`, `todoist`, `herdr`, `worktree`, `exit-protocol`, and `footer`, including nested TypeScript files.
- Only named `SessionState` imports are allowed. `ExtensionState`, `SessionContext`, state helpers, default imports, and namespace imports produce one diagnostic per forbidden binding.
- Added `program` to lint context so rules can resolve module targets.
- Moved shared `applyStatePatch` implementation to `src/shared/session-state.ts`, retained root re-export for compatibility, and updated Todoist imports.
- Removed scoped-module imports of root `createSessionState`; compatibility factory paths now use local empty SessionState literals.

## Tests

- Expanded `test/lint/no-extension-state-in-modules.test.ts` for `ExtensionState`, `SessionContext`, `applyStatePatch`, `currentSessionContext`, multiple forbidden bindings, namespace imports, allowed `SessionState`, and all scoped module directories.

## Validation

- `npx vitest run test/lint/no-extension-state-in-modules.test.ts` — passed, 7 tests.
- `npx vitest run test/lint/no-extension-state-in-modules.test.ts test/root-state.test.ts test/session-state.test.ts` — passed, 21 tests.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck` — passed.
- `npm run architecture` — passed, 191 modules / 703 dependencies.
- `env -u PI_SUBAGENT_CHILD npm test` — passed, 51 files / 303 tests passed / 8 skipped.
- `git diff --check` — passed.

## Rulings

No compatibility exception or main-only root import ruling needed. Scoped production modules have no remaining imports from root `state.ts` except `SessionState`.

## Residual risks

- Root `state.ts` continues to re-export `applyStatePatch` for existing callers/tests; no scoped module imports that re-export.
- Existing compatibility factory overloads remain until no longer needed by later cleanup; their fallback state is module-local and does not cross root import boundary.
