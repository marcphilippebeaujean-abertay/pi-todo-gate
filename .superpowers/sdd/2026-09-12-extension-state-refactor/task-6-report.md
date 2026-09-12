# Task 6 Report: Root Lifecycle Coordination

## Implementation

- Moved session start, shutdown, handoff, config loading, native bridges, state-tool registration, and before-agent/message orchestration into `src/event-consumer.ts`.
- Added stateful `RootEventPublisher` in `src/event-publishers.ts` with reset, activation, and deactivation channels.
- Native `tool_result` bridge forwards `{ event, context }` only; Worktree and PR consume typed channel independently.
- Root owns stable `SessionState` clearing and `PromptQueue` reset. Module updates continue through serialized root snapshots.
- Removed compatibility session projection from `moduleState`, renamed shared session contract to `SessionRecord`, removed state-ref module projections, and deleted `src/application/`.
- Preserved persisted `WorkState` parsing/projection and direct Exit Protocol → Worktree cleanup action.
- Worktree footer projection now consumes root PR/task module snapshots, avoiding deleted application state.
- Structure checker rejects reintroduced `src/application/`; root orchestration lint exceptions allow required coordinator shape.

## Rulings

- Retained module-local `PrRuntime`/`TodoistRuntime` contracts for command/consumer dependency bundles; removed root `ExtensionState` runtime adapter, WeakMap/application projection, and `stateRef` projection. These contracts are not root lifecycle adapters.
- Kept one shared `prMergedEvent: Event<PrMergedEvent>` and Exit Protocol-owned action descriptors per authoritative decision.
- Lifecycle reset emission is awaited. Event channels invoke synchronous subscribers without an unnecessary microtask yield, preventing reset callbacks from deactivating newly activated modules.

## Validation

- `npm run architecture` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `git diff --check` — passed.
- `env -u PI_SUBAGENT_CHILD npm test` — passed: 51 files, 293 tests passed, 8 skipped.
- Focused lifecycle/module/integration Vitest run — passed: 6 files, 53 tests passed, 8 skipped.

## Residual risks

- `PrRuntime` and `TodoistRuntime` remain internal module dependency bundles and can be further flattened in later cleanup if required; no root lifecycle code depends on compatibility state projection.
- Existing skipped Todoist race tests remain skipped from prior tasks.
