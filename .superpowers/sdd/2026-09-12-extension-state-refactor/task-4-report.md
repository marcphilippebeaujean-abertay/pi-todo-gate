# Task 4 Report: PR Module Ownership

## Implementation

- Added PR-owned module facet state for remote origin, pinned PR, discovery eligibility/tested URLs, operation generation, and merged-PR metadata.
- Added narrow `PrModule` construction contract receiving `PromptQueue`, typed `EventHandler`, stable `SessionState`, session lookup, PI registration, and PR dependencies.
- Moved remote-origin discovery, PR URL discovery, discovery eligibility, merge-currentness checks, and merge tool-result handling out of application event handlers.
- PR now emits `moduleStateChangedEvent` updates and `gitStatePatch.remoteOrigin` for discovered origins.
- PR subscribes to shared `prMergedEvent` and records merged metadata in PR module state. No request/collect/present channels added.
- PR command and state-tool code no longer imports `ExtensionState` or `SessionContext`; local PR contracts are in `src/pr/state.ts`.
- Preserved persisted WorkState projection and existing application compatibility adapters. `src/application/` remains for later lifecycle tasks.

## Ruling

Task 4 plan wording about separate PR merge channels conflicts with authoritative decisions. Preserved one shared `prMergedEvent: Event<PrMergedEvent>` and Exit Protocol action ownership. No `PrMergedRequest`, requested, collect, or present channels introduced.

## Validation

- `env -u PI_SUBAGENT_CHILD npx vitest run test/pr test/extensions/pi-todo-gate.test.ts` — passed, 88 tests / 8 skipped.
- `env -u PI_SUBAGENT_CHILD npm test` — passed architecture plus 288 tests / 8 skipped.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck -- --pretty false` — passed.
- `git diff --check` — passed.

## Review fixes

- Session activation now emits complete PR facet snapshots; state-tool set/clear actions call PR sync and emit complete snapshots.
- Origin updates always emit complete PR state, preventing root replacement from dropping pinned PR, generation, tested URLs, or merge metadata.
- Origin and candidate discovery capture session/generation tokens; stale async completions cannot mutate session or facet state.
- Before-agent prompt flow now uses guarded origin discovery, persists session origin, and emits `gitStatePatch.remoteOrigin`.
- Added activation/sync, stale-origin, stale-candidate, and mid-session-origin regression tests.

## Review-fix validation

- `env -u PI_SUBAGENT_CHILD npx vitest run test/pr test/extensions/pi-todo-gate.test.ts` — passed, 91 tests / 8 skipped.
- `env -u PI_SUBAGENT_CHILD npm test` — passed architecture plus 291 tests / 8 skipped.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck -- --pretty false` — passed.
- `npm run architecture` — passed dependency and module checks.
- `git diff --check` — passed.

## Residual risks

- Transitional `SessionContext` and `src/application/` remain by design for Tasks 5–6.
- Legacy compatibility `isCurrentMerge` remains exported from `src/shared/work-state.ts` for existing tests; PR runtime uses PR-owned guard in `src/pr/event-consumers.ts`.
- PR module state metadata is runtime module state; legacy persisted WorkState entry shape remains unchanged for compatibility.
