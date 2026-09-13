# SDD ledger — plan: docs/superpowers/plans/2026-09-12-extension-state-refactor.md

## Preflight scan

| Item | Shared files/interfaces | Finding | Ruling |
|---|---|---|---|
| Task 1 | `PromptQueue`, module imports | Moves queue before event/module migration; later tasks consume root path. | Proceed in order. |
| Task 2 | `shared/events.ts`, all event consumers | Replaces current string bus; Task 3 adds state channels on same primitive. | Task 2 owns primitive; Task 3 extends named contracts. |
| Task 3 | `state.ts`, `event-consumer.ts`, events | Adds `gitState` and snapshot event consumed by later modules. | Snapshot contract is authoritative. |
| Task 4 | PR state/events, shared persisted state | PR extraction depends on Task 2/3 typed channels. | Do after Task 3. |
| Task 5 | module event consumers/state, integration tests | Module ownership depends on typed channels and SessionState shape. | Do after Task 4; keep behavior tests green. |
| Task 6 | root consumer/main, delete application | Consumes all module APIs and removes transitional adapters. | Do after module migration. |
| Task 7 | lint rules and module imports | Enforces boundary after imports are migrated. | Do after Task 6; expand rule to all forbidden root bindings. |
| Task 8 | architecture/lint/full suite | Final gate only after all prior changes. | Do last. |
| Task 1 self-check | root prompt file and imports | Test and implementation signatures agree. | Clean. |
| Task 2 self-check | `Event<T>` and named channels | Async callback/unsubscribe behavior is explicit. | Clean. |
| Task 3 self-check | snapshot ordering and Git patch | Previous snapshot precedes mutation; current follows mutation. | Clean. |
| Task 4 self-check | PR-owned discovery/merge guards | Narrow PR state/API required. | Clean. |
| Task 5 self-check | four module owners | Each module gets constructor dependencies and typed listeners. | Clean. |
| Task 6 self-check | root publisher class and deletion | No Worktree refresh publisher; native tool bridge remains root. | Clean. |
| Task 7 self-check | root import rule | SessionState is sole allowed root state import from scoped modules. | Clean. |
| Task 8 self-check | final commands and identifiers | Verification commands cover spec acceptance. | Clean. |

## Rulings

Ruling: execute sequentially because tasks share interfaces and migration order matters; parallel writers would conflict.

Ruling: root native PI events are bridges only; Worktree and PR own interpretation of `tool_result`.

Ruling: `Event<T>` implementation lives in `src/shared/events.ts`; named payload contracts remain beside their owning event domain unless cross-module.

Ruling: PR merge uses one `prMergedEvent: Event<PrMergedEvent>`; same-type requested/merged channels were rejected as duplicate lifecycle signals. Exit Protocol owns action descriptors and calls Worktree directly after submit.

Ruling: continue one additional Task 6 fix pass beyond the nominal review loop because the remaining handoff persistence race is concrete and load-bearing; defer final inherited-state persistence until the post-activation projected state is authoritative.

## Progress

- Task 1: complete — `c2a8fde`; review verdict OK; full verification 52 files / 283 passed / 8 skipped.
- Task 2: complete — `e83887c`, `6d90633`, `9431ae1`; typed channels, direct merged payload, Exit Protocol-owned worktree action; focused review initially blocked obsolete request contract, resolved by removing `PrMergedRequest`; lint/typecheck/architecture pass; serial full suite 281 passed / 8 skipped.
- Task 3: complete — `aa71adb`, `3b690ea`, `173acbf`, `ab0180d`; stable Git/session state, clone-safe and serialized snapshots, reset coverage; final re-review verdict OK; 286 tests passed / 8 skipped, lint/typecheck/architecture pass; report at `task-3-report.md`
- Task 4: complete — `f05b3a5`, `b9679c7`, `888fdcc`, `896a240`; PR ownership, complete facet snapshots, stale async guards, mid-session Git origin updates, and stale adapter removal; final re-review verdict OK; 290 tests passed / 8 skipped, lint/typecheck/architecture pass; report at `task-4-report.md`
- Task 5: complete — review fixes add serialized Worktree refresh validity, remove duplicate root status inspection, narrow unused constructor options, and pass Todoist narrow dependencies; 294 tests passed / 8 skipped, lint/typecheck/architecture pass; report at `task-5-report.md`
- Task 6: complete — `44d158ae`, `7a5bf93`, `12f4399`, `b3b23da`, `5ae67d1`, `e47e2d1`, `07d4004`; root lifecycle coordination, epochs/reset barriers, startup/handoff projection, Todoist shutdown reset, typed Worktree status, and deletion of `src/application/`; final re-review verdict OK; 296 tests passed / 8 skipped, lint/typecheck/architecture pass; report at `task-6-report.md`
- Task 7: complete — root-state import lint boundary expanded to all scoped modules; forbidden bindings migrated to shared/module-local state; focused/full validation passed; report at `task-7-report.md`
- Task 8: complete — final production architecture checker and assertions added; `env -u PI_SUBAGENT_CHILD npm test` passed 310 tests / 8 skipped, architecture/lint/typecheck/diff checks passed; report at `task-8-report.md`; final commit pending.
