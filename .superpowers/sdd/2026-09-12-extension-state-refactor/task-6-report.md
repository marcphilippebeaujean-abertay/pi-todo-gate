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
- `env -u PI_SUBAGENT_CHILD npm test` — passed: 51 files, 298 tests passed, 8 skipped.
- Focused lifecycle/module/integration Vitest run — passed: 11 files, 108 tests passed, 8 skipped.

## Review fixes

- Added root lifecycle epoch guards around reset, config loading, worktree/PR/footer activation, lifecycle publication, and persisted PR discovery. Older starts cannot activate or persist after newer starts or shutdown.
- Added reset epochs and active-update barriers to serialized module-state consumption. Stale fire-and-forget deactivation updates cannot repopulate cleared state.
- Removed duplicate lifecycle deactivation paths: root directly deactivates Worktree; typed deactivation owns Footer/Exit; Todoist reset owns claim reset.
- Replaced Worktree sibling module-state reads with typed `worktreeStatusEvent`; root formats footer state from active session.
- Added concurrent start/shutdown, startup module snapshot, and post-drain reset regression coverage.
- Added Todoist terminal deactivation claim-reset coverage.
- Startup establishes active-session acceptance before PR remote-origin discovery and Worktree initialization, then drains root module updates before initial persistence and footer projection.
- Startup regression asserts retained `sessionState.gitState.remoteOrigin` alongside Worktree Git fields, including persisted-origin startup without rediscovery.
- Deferred inherited handoff persistence until after active-session PR/Git projection; merge final projected remoteOrigin into inherited state so discovered origin cannot be overwritten.
- Handoff regression covers inherited state without remoteOrigin and verifies final persisted state retains current Git origin.
- PR origin requests carry lifecycle epoch identity; stale discovery cannot append state or mutate PR module state after shutdown. Concurrent shutdown regression covers this barrier.

## Residual risks

- `PrRuntime` and `TodoistRuntime` remain internal module dependency bundles and can be further flattened in later cleanup if required; no root lifecycle code depends on compatibility state projection.
- Existing skipped Todoist race tests remain skipped from prior tasks.
