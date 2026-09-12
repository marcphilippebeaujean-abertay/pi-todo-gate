# Task 5 Report: Worktree, Todoist, Footer, and Exit Protocol Ownership

## Implementation

- Worktree receives typed EventHandler and stable SessionState through canonical options; unused PromptQueue removed from its narrow contract.
- Worktree subscribes to typed `toolResultEvent`, owns dirty-status refresh, emits Worktree module state with Git patches, and emits typed PR/task footer updates.
- Todoist now has module-owned claim operation state and exposes claim dispatch through its module. It clears claim state from typed `sessionResetEvent` and `sessionDeactivatedEvent` listeners. Existing stale-safe completion path remains in Todoist completion/consumer code.
- Footer receives typed EventHandler and PI/persistence dependencies, subscribes to typed footer and deactivation channels, and retains private persisted/render state.
- Exit Protocol receives PromptQueue, typed EventHandler, and Worktree dependency, tracks private exit request state, listens to typed lifecycle channels, and preserves direct Worktree `removeWorktree()` action execution after submit.
- Root composition injects narrow dependencies into all four modules. Root tool-result bridge no longer interprets Worktree status; Worktree owns that interpretation.
- Preserved one shared `prMergedEvent: Event<PrMergedEvent>` and existing persistence/lifecycle compatibility. `src/application/` remains intact for Task 6.

## Ruling

No new plan conflict. Authoritative rulings preserved: one shared `prMergedEvent`, Exit Protocol-owned action descriptors, direct Worktree action invocation, and no Task 6 migration.

## Review Fixes

- Serialized Worktree refresh validity with a monotonic sequence token plus session generation. Concurrent tool-result refreshes can no longer publish stale Git/footer state.
- Removed duplicate transitional root Worktree status inspection and refresh call from `src/application/session.ts`; lifecycle orchestration remains otherwise unchanged.
- Narrowed unused Worktree/Footer/Exit constructor options and passed only declared Todoist dependencies from `main.ts`.

## Tests Added

- Worktree ownership test for typed tool-result status refresh, module state, Git patch, and footer update.
- Worktree concurrent stale-result regression test proving older refresh cannot publish after newer refresh.
- Todoist ownership test for typed session-reset claim clearing.
- Footer ownership test for typed footer-event consumption.

## Validation

- `env -u PI_SUBAGENT_CHILD npx vitest run test/worktree/module.test.ts test/todoist/module.test.ts test/footer/module.test.ts test/exit-protocol/module.test.ts test/integration` — passed, 32 tests.
- `env -u PI_SUBAGENT_CHILD npm test` — passed, 294 tests / 8 skipped; architecture passed.
- `npm run lint` — passed Biome and strict lint.
- `npm run typecheck -- --pretty false` — passed.
- `git diff --check` — passed.

## Residual Risks

- Transitional `src/application/` and SessionContext adapter remain by design for Task 6.
- Worktree initialization now awaits in transitional session orchestration so owned initial status is available before initial footer projection; no lifecycle responsibilities moved.
- Compatibility overloads remain on module factories for existing callers until later lifecycle cleanup.
