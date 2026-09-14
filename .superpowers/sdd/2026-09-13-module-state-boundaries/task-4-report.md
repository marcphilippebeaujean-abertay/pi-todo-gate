# Task 4 completion report

## Status

Completed Task 4 takeover after prior Luna worker timed out with an uncommitted partial diff. Existing worktree changes were preserved and completed in place; no reset or discard performed.

Implementation commit: `d2c739da878a87c49ad7c3dfa149750bb7fd422d`
Fix round commit: `d23abbdc37029ed4b699e36df2a97082a6e2c31a`

## Changes

- Removed module-entrypoint `internal-state.ts` re-exports.
- Kept serializable state contracts/descriptors/helpers in each `module-state.ts`.
- Kept runtime contracts and dependency operation objects internal.
- Removed lifecycle methods from public PR, Todoist, Footer, Exit Protocol, and Worktree contracts.
- Exposed Worktree cleanup capability only: `WorktreeCleanup.getWorktreeInfo()` and `removeWorktree()`.
- Removed Worktree `getHasUncommittedChanges` capability.
- Kept PR, Todoist, and Herdr implementation lifecycle behavior private/event-driven.
- Added shared PR discovery/message/before-agent events for minimum caller handoff.
- Added compile-facing public API boundary test with lifecycle negative checks.
- Updated affected tests and internal imports.

## Commands and output

Prior takeover inspection:

- Read `.superpowers/sdd/2026-09-13-module-state-boundaries/task-4-brief.md`.
- Read `.superpowers/sdd/2026-09-13-module-state-boundaries/task-4-partial.diff`.
- Inspected existing `git status`/diff. Partial diff preserved.

Specified module tests, initial child-environment run:

```text
npx vitest run test/pr test/todoist test/worktree test/footer test/exit-protocol test/herdr
```

Result: failed because inherited `PI_SUBAGENT_CHILD=1` causes Herdr setup to skip; 17 Herdr tests failed before implementation paths ran.

Validation run with test-only child marker removed:

```text
env -u PI_SUBAGENT_CHILD npx vitest run test/pr test/todoist test/worktree test/footer test/exit-protocol test/herdr
```

Result: PASS — 20 test files, 178 tests.

Full suite before fix round:

```text
env -u PI_SUBAGENT_CHILD npx vitest run
```

Result: PASS — 58 test files, 377 passed, 8 skipped.

Typecheck:

```text
npm run typecheck
```

Result: PASS (`tsc --noEmit`).

Architecture:

```text
npm run architecture
```

Result: PASS — no dependency violations; module structure check passed.

Strict lint:

```text
npm run lint:strict
```

Result: PASS.

Biome:

```text
npm run lint:biome
```

Result: PASS — 192 files checked, no diagnostics.

Self-review:

```text
git diff --check
```

Result: PASS before implementation commit. Commit hooks reran Biome, strict lint, and typecheck successfully.

## Fix round 1 review findings

Follow-up review findings addressed without widening Task 5 scope.

- Removed PR `event-consumers.ts` and `event-publishers.ts` public wildcard exports. `isCurrentMerge` remains implementation/test-internal.
- Removed Herdr event-consumer/publisher wildcard exports. Retained `installHerdrTabClaim` setup entrypoint and side-effect imports; worker handles/cancellation contracts are no longer entrypoint exports.
- Removed Todoist event-consumer/publisher wildcard exports. Internal operation APIs remain reachable only through module-local imports.
- Removed Worktree git helper re-exports; public entrypoint now retains cleanup capability and state/events exports only.
- Added Vitest setup that clears inherited `PI_SUBAGENT_CHILD` only inside tests. Production `isSubagent()` guard unchanged.
- Replaced `unknown` dependency fields and Todoist cast with precise types inferred from public factory/setup signatures.
- Updated tests to import implementation helpers from owning internal facets.

### Fix-round commands and output

```text
npx vitest run test/pr test/todoist test/worktree test/footer test/exit-protocol test/herdr
```

PASS — 20 test files, 178 tests. Passes with inherited `PI_SUBAGENT_CHILD=1`; no environment surgery.

```text
npm run test
```

PASS — architecture passed; 59 test files, 378 passed, 8 skipped.

```text
npm run typecheck
```

PASS — `tsc --noEmit`.

```text
npm run architecture
```

PASS — no dependency violations; 211 modules, 814 dependencies cruised.

```text
npm run lint:strict
```

PASS.

```text
npm run lint:biome
```

PASS — 193 files checked, no diagnostics.

```text
git diff --check
```

PASS.

Self-review confirmed no `export *` of scoped implementation event consumer/publisher facets from PR, Herdr, or Todoist entrypoints; no Worktree git-helper entrypoint exports; no public lifecycle methods restored. Fix round committed as `d23abbdc37029ed4b699e36df2a97082a6e2c31a`.

No staged files remain.
