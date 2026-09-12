# Extension State Refactor Design

## Status

Draft; implementation starts after owner review of this spec.

## Goal

Replace the transitional application-state adapter with a real state coordinator:

- `main.ts` constructs one stable `ExtensionState`.
- `SessionState` exists for the extension lifetime; only `sessionId` changes between `null` and an active ID.
- Modules own their state and behavior.
- Modules receive constructor dependencies once.
- Modules communicate through typed events, never through sibling modules or the root `ExtensionState`.
- Root event consumers coordinate lifecycle and apply module state updates.
- `src/application/` is deleted after its responsibilities move to root consumers/publishers and owning modules.

Behavior must remain unchanged.

## Public state contracts

`src/state.ts` contains `SessionState`, `ExtensionState`, and state construction. Reusable Git-state contracts live in `src/shared/session-state.ts` so event contracts and modules do not import root application types. `PromptQueue` and its `PromptTask` type live in root `src/prompt-queue.ts`:

```ts
interface SessionState {
  sessionId: string | null;
  gitState: GitState;
  moduleState: Record<string, unknown>;
}

interface ExtensionState {
  sessionState: SessionState;
  promptQueue: PromptQueue;
  eventHandler: EventHandler;
  footer: FooterModule;
  pr: PrModule;
  todoist: TodoistModule;
  worktree: WorktreeModule;
  exitProtocol: ExitProtocolModule;
  // PI API and dependency objects remain root infrastructure.
}
```

`SessionState` is constructed once. Shutdown mutates that same object:

```ts
sessionState.sessionId = null;
sessionState.gitState = {};
sessionState.moduleState = {};
```

`ExtensionState` and any session-context aggregate type are used only by `main.ts`. Submodules may import `SessionState` from root `state.ts`, but may not import `ExtensionState`, `SessionContext`, or root application adapters.

Module-specific types move to their module `state.ts`. Persisted work-state parsing/projection moves to a shared/root-owned contract that does not require importing `ExtensionState`.

### Prompt queue ownership

`src/prompt-queue.ts` is root infrastructure. `main.ts` constructs the single queue and injects it into modules. Root event consumers reset it during lifecycle transitions. Modules may enqueue work but do not reset or replace the queue.

Prompt-related helpers are classified by ownership:

- interactive module prompts stay in their owning module `user-prompts.ts`;
- exit prompt orchestration stays in the Exit Protocol module;
- worker argument/text utilities in `src/shared/pi-worker.ts` remain shared because they describe the subprocess protocol, not user prompt coordination;
- no prompt queue or generic interactive prompt utility remains in `src/shared/`.

## Ownership boundaries

### Root

Root owns:

- construction and registration order;
- native PI lifecycle event registration;
- loading persisted state/configuration;
- session activation/deactivation sequencing;
- resetting shared `SessionState`, `PromptQueue`, and module reset commands;
- applying `moduleStateChanged` updates;
- emitting `sessionStateChanged` after every accepted update;
- producing persisted state entries from current state projections.

Root does not inspect or mutate module-private state fields directly.

### PR module

PR module owns:

- remote-origin discovery;
- pinned PR state and discovery eligibility;
- tested PR URLs;
- merge-operation generation and stale-merge checks;
- `isCurrentMerge`;
- persisted PR-state projection;
- PR command registration and PR-related event consumers.

Remote-origin discovery runs in PR code. On success, PR emits a module-state update containing its state and a shared Git patch containing `remoteOrigin`.

### Worktree module

Worktree module owns:

- worktree baseline and lifecycle;
- Git status inspection;
- `hasUncommittedChanges` tracking;
- shared Git patches for branch/worktree/dirty status;
- footer status events derived from Git state;
- worktree cleanup actions.

Working-tree refresh runs in Worktree code after Worktree consumes typed `toolResultEvent`. Worktree may consume `sessionStateChanged` when shared Git state is relevant, but never reads PR or Todoist module entries.

### Todoist module

Todoist module owns:

- task state projection;
- claim operation state and reset;
- claim worker lifecycle and stale-result checks;
- task completion operation and completion metadata;
- Todoist event consumers and persisted Todoist-state projection.

Todoist claim reset is handled by its event consumer in response to the root reset action event. Root only emits the reset command.

### Footer module

Footer owns:

- footer rendering and persisted footer state;
- current UI context;
- status rendering from explicit footer/status events.

Footer receives shared constructor references and registers listeners during construction. It does not inspect PR, Todoist, or Worktree state.

### Exit-protocol module

Exit protocol owns:

- exit action collection and presentation;
- prompt queue consumption;
- exit protocol reset/deactivation in response to root lifecycle events.

## Event contracts and flow

Shared event contracts and the generic typed event channel live in `src/shared/events.ts`. Root action publishers live in new root `src/event-publishers.ts`. Root consumers live in `src/event-consumer.ts`.

The shared event primitive is:

```ts
interface Event<T> {
  emit(payload: T): Promise<void>;
  subscribe(callback: (payload: T) => void | Promise<void>): () => void;
}

function event<T>(): Event<T>;
```

Every event uses a named typed channel on the relevant `EventHandler` or module event bundle. Producers call `.emit(payload)` and consumers call `.subscribe(callback)`. String event names, untyped payload maps, `.on(...)`, and `.setupListener(...)` are removed from module event code. Existing ordering-sensitive behavior is preserved by channel subscription order or explicit typed channel sequencing.

### Module-to-root state flow

Modules emit through a typed channel:

```ts
interface ModuleStateChangedEvent {
  moduleId: string;
  moduleState: Record<string, unknown>;
  gitStatePatch?: Partial<GitState>;
}

interface SessionStateChangedEvent {
  previousState: SessionState;
  currentState: SessionState;
}

interface EventHandler {
  moduleStateChangedEvent: Event<ModuleStateChangedEvent>;
  sessionStateChangedEvent: Event<SessionStateChangedEvent>;
  toolResultEvent: Event<{ event: ToolResultEvent; context: ExtensionContext }>;
  // other named typed channels
}
```

Root subscribes to `moduleStateChangedEvent`, validates the addressed update, replaces `sessionState.moduleState[moduleId]`, applies the optional Git patch, deep-copies the previous/current snapshots, and emits `sessionStateChangedEvent`.

The stable `SessionState` reference remains unchanged. The event communicates the complete current state after the update. Root is the only writer for the general state-change event.

### Root-to-module action flow

`src/event-publishers.ts` contains `RootEventPublisher`, which stores `EventHandler` in its constructor. Its methods emit typed lifecycle actions without receiving `EventHandler` at each call:

```ts
class RootEventPublisher {
  constructor(private readonly eventHandler: EventHandler) {}
  publishSessionReset(): Promise<void>;
  publishSessionActivated(payload: SessionActivatedEvent): Promise<void>;
  publishSessionDeactivated(): Promise<void>;
}
```

Root publishers emit typed actions through named event channels for:

- `sessionActivated` with session identity and lifecycle context data needed by modules;
- `sessionDeactivated`;
- `sessionReset`;
- native PI event bridges that forward `tool_result` without module-specific interpretation;
- other explicit orchestration requests that cannot be handled by a module-native listener.

The root native bridge forwards `tool_result` unchanged through a typed channel:

```ts
pi.on("tool_result", (event, context) =>
  eventHandler.toolResultEvent.emit({ event, context }),
);
```

Worktree subscribes to `toolResultEvent` and decides whether Git status needs refreshing. PR subscribes independently for merge detection. No root Worktree-refresh publisher exists. Modules subscribe to typed channels in constructors. No module is registered by passing `ExtensionState` to a module method. Module-local event bundles use the same shared `Event<T>` primitive; Herdr's custom `.on/.emit` event API is migrated too.

### Lifecycle sequence

Session start:

1. Root resets shared state and emits `sessionReset`.
2. Root loads config and determines whether project is configured.
3. For configured projects, root sets `sessionState.sessionId` and emits `sessionActivated`.
4. Modules initialize their private state and emit `moduleStateChanged` as needed.
5. Root applies updates and emits `sessionStateChanged` after each update.

Session shutdown or unconfigured transition:

1. Root emits `sessionDeactivated`.
2. Root resets PromptQueue and clears `sessionState.sessionId`, `gitState`, and `moduleState`.
3. Root removes session-specific native registrations/statuses.

Remote-origin discovery:

1. PR module inspects the remote.
2. PR module emits its module update plus `gitStatePatch.remoteOrigin`.
3. Root applies both and emits complete `sessionStateChanged`.
4. Worktree or other modules may consume the general event if needed.

Native tool-result flow:

1. PI sends native `tool_result` to the root bridge.
2. Root emits typed `toolResultEvent` without interpreting the result.
3. Worktree module subscribes and decides whether Git status must be refreshed.
4. PR module subscribes independently when merge detection needs the result.
5. Each module emits its own state/footer events; root applies state updates and emits complete `sessionStateChanged`.

## File migration

- Move root lifecycle/event coordination from `src/application/session.ts`, `src/application/lifecycle.ts`, and `src/application/event-handlers.ts` into `src/event-consumer.ts` and `src/event-publishers.ts`.
- Move remote-origin discovery and merge-currentness logic into PR facets.
- Move working-tree status initialization/refresh into Worktree event consumers.
- Move Todoist claim reset into Todoist event consumers.
- Move `src/shared/prompt-queue.ts` to root `src/prompt-queue.ts`, including `PromptTask`.
- Keep PromptQueue reset in root event consumer.
- Remove root `SessionContext`, WeakMap/session adapters, `ApplicationContext`, and all runtime compatibility wrappers.
- Delete `src/application/` after imports and tests migrate.
- Update `main.ts` to construct root `PromptQueue` and modules once, pass `PromptQueue`, `EventHandler`, and stable `SessionState` to constructors, then register root consumers.

## Lint and architecture rules

Add a lint rule covering every scoped submodule:

- imports from root `state.ts` may import `SessionState` only;
- `GitState` comes from shared session-state contracts, not root `state.ts`;
- `ExtensionState`, `SessionContext`, and root application-state helpers are forbidden;
- root `main.ts` remains the composition root and may use `ExtensionState`.

Add tests for allowed `SessionState` imports and rejected `ExtensionState`/`SessionContext` imports, plus rejection of other root-state imports from scoped modules. Keep dependency-cruiser rules forbidding sibling-module imports.

## Testing

Add or migrate tests covering:

- stable SessionState identity and nullable session ID;
- Git-state reset on shutdown;
- module-state replacement isolation;
- root emission of complete `sessionStateChanged` after module updates;
- constructor listener registration and shared dependency identity;
- PR remote-origin discovery and stale merge guards;
- Worktree-owned status refresh;
- Todoist-owned claim reset;
- lifecycle behavior for configured, unconfigured, handoff, and shutdown sessions;
- absence of `src/application/`, forbidden imports, and sibling-module imports.

Final verification:

```text
npm test
npm run lint
npm run typecheck
git diff --check
```

## Acceptance criteria

- No `src/application/` directory remains.
- No `ActiveSession`, `ExtensionRuntime`, `SessionContext`, or `ApplicationContext` compatibility type remains.
- No scoped module imports `ExtensionState` or root application helpers.
- Modules receive shared dependencies through constructors and subscribe to typed `Event<T>` channels.
- Root applies module updates and emits complete general state-change events.
- PR owns remote-origin discovery and merge guards.
- Worktree owns Git status refresh.
- Todoist owns claim reset.
- Existing behavior and full verification suite remain passing.
