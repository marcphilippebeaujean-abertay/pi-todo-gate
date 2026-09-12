# Task 5 Report: Worktree, Todoist, Footer, and Exit Protocol Ownership

## Implementation

- Worktree now receives shared PromptQueue, EventHandler, and stable SessionState through canonical constructor options.
- Worktree subscribes to typed `toolResultEvent`, owns dirty-status refresh, emits Worktree module state with Git patches, and emits typed PR/task footer updates.
- Todoist now has module-owned claim operation state and exposes claim dispatch through its module. It clears claim state from typed `sessionResetEvent` and `sessionDeactivatedEvent` listeners. Existing stale-safe completion path remains in Todoist completion/consumer code.
- Footer now receives shared constructor dependencies and subscribes to typed footer and deactivation channels while retaining private persisted/render state.
- Exit Protocol now receives shared constructor dependencies, tracks private exit request state, listens to typed lifecycle channels, and preserves direct Worktree `removeWorktree()` action execution after submit.
- Root composition now injects shared dependencies into all four modules. Root tool-result bridge no longer interprets Worktree status; Worktree owns that interpretation.
- Preserved one shared `prMergedEvent: Event<PrMergedEvent>` and existing persistence/lifecycle compatibility. `src/application/` remains intact for Task 6.

## Ruling

No new plan conflict. Authoritative rulings preserved: one shared `prMergedEvent`, Exit Protocol-owned action descriptors, direct Worktree action invocation, and no Task 6 migration.

## Tests Added

- Worktree ownership test for typed tool-result status refresh, module state, Git patch, and footer update.
- Todoist ownership test for typed session-reset claim clearing.
- Footer ownership test for typed footer-event consumption.

## Validation

- `env -u PI_SUBAGENT_CHILD npm test` — passed, 293 tests / 8 skipped; architecture passed.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck -- --pretty false` — passed.
- `git diff --check` — passed.

## Residual Risks

- Transitional `src/application/` and SessionContext adapter remain by design for Task 6.
- Compatibility overloads remain on module factories for existing callers until later lifecycle cleanup.
