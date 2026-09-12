# Extension State Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace transitional runtime/session adapters with stable root state, typed event channels, module-owned state, and root lifecycle coordination.

**Architecture:** `main.ts` is composition root and sole consumer of `ExtensionState`. Root `event-consumer.ts` coordinates native lifecycle, applies module updates, deep-copies state snapshots, and emits typed state-change events. Scoped modules receive `PromptQueue`, `EventHandler`, and stable `SessionState` through constructors; they communicate only through typed channels.

**Tech Stack:** TypeScript, Vitest, TypeBox, Biome, dependency-cruiser, custom TypeScript lint rules.

**Spec:** `docs/superpowers/specs/2026-09-12-extension-state-refactor-design.md`

## Global Constraints

- `SessionState` object remains stable for extension lifetime; `sessionId` starts and resets to `null`.
- `SessionState` contains first-class `gitState` and `moduleState` only for shared/module state.
- `ExtensionState`, `SessionContext`, and root application adapters are used only by `main.ts`.
- Scoped modules may import only `SessionState` from root `state.ts`; module contracts live in module `state.ts` or shared contracts.
- Modules never import sibling modules or receive `ExtensionState`.
- Every event uses shared generic `Event<T>` with typed `.emit(payload)` and `.subscribe(callback)`.
- Root deep-copies state before and after each accepted module update.
- Root owns lifecycle/reset coordination; PR owns remote-origin/merge guards; Worktree owns Git status; Todoist owns claim reset.
- Preserve existing behavior and persisted state compatibility.
- Run `npm test`, `npm run lint`, `npm run typecheck`, and `git diff --check` at final gate.

---

### Task 1: Move PromptQueue to Root Infrastructure

**Files:**
- Create: `src/prompt-queue.ts` (move `PromptTask` and `PromptQueue` from `src/shared/prompt-queue.ts`)
- Modify: `src/main.ts`, `src/state.ts`, `src/exit-protocol/module.ts`, `src/exit-protocol/state.ts`, `src/exit-protocol/event-consumers.ts`, `src/todoist/state.ts`, `src/shared/module-context.ts`
- Delete: `src/shared/prompt-queue.ts`
- Test: existing PromptQueue and exit-protocol tests; add `test/prompt-queue.test.ts` if coverage is currently indirect

**Interfaces:**
- Produces `src/prompt-queue.ts` exports:
  ```ts
  export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;
  export class PromptQueue {
    enqueue<T>(task: PromptTask<T>): Promise<T | undefined>;
    reset(): void;
    drain(): Promise<void>;
  }
  ```
- Later tasks import `PromptQueue` from `../prompt-queue.ts` or `./prompt-queue.ts`, never from `shared`.

- [ ] **Step 1: Write/update import-level test**

Add a test that imports `PromptQueue` from `src/prompt-queue.ts`, queues two tasks, calls `reset()`, and verifies the stale task receives no result while the current task runs.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npx vitest run test/prompt-queue.test.ts`

Expected: FAIL because root file does not exist.

- [ ] **Step 3: Move implementation and update imports**

Move implementation unchanged to `src/prompt-queue.ts`; update all imports. Remove `src/shared/prompt-queue.ts`. Keep worker prompt utilities in `src/shared/pi-worker.ts` because they describe subprocess arguments, not interactive prompt coordination.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/prompt-queue.test.ts test/exit-protocol/module.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompt-queue.ts src/main.ts src/state.ts src/exit-protocol src/todoist/state.ts src/shared/module-context.ts test/prompt-queue.test.ts
git rm src/shared/prompt-queue.ts
git commit -m "refactor: move prompt queue to root infrastructure"
```

---

### Task 2: Introduce Shared Typed Event Primitive

**Files:**
- Modify: `src/shared/events.ts`, `src/shared/constants.ts`
- Modify: `src/herdr/events.ts`, `src/herdr/event-consumers.ts`, `src/herdr/event-publishers.ts`
- Modify: all module event consumers/publishers and root event consumers
- Test: `test/events.test.ts`, add typed-channel cases

**Interfaces:**
- Produces shared primitive:
  ```ts
  export type EventCallback<T> = (payload: T) => void | Promise<void>;
  export interface Event<T> {
    emit(payload: T): Promise<void>;
    subscribe(callback: EventCallback<T>): () => void;
  }
  export function event<T>(): Event<T>;
  ```
- `EventHandler` exposes named channels, including:
  ```ts
  moduleStateChangedEvent: Event<ModuleStateChangedEvent>;
  sessionStateChangedEvent: Event<SessionStateChangedEvent>;
  sessionResetEvent: Event<SessionResetEvent>;
  sessionActivatedEvent: Event<SessionActivatedEvent>;
  sessionDeactivatedEvent: Event<SessionDeactivatedEvent>;
  prMergedEvent: Event<PrMergedEvent>;
  ```
- Module-local bundles, including Herdr, use the same `Event<T>` primitive.

- [ ] **Step 1: Add failing generic event tests**

In `test/events.test.ts`, verify:

```ts
const channel = event<{ value: number }>();
const values: number[] = [];
const unsubscribe = channel.subscribe(({ value }) => values.push(value));
await channel.emit({ value: 1 });
unsubscribe();
await channel.emit({ value: 2 });
expect(values).toEqual([1]);
```

Add a compile-level/runtime test proving callback payload is typed and async subscribers are awaited.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run test/events.test.ts`

Expected: FAIL because `Event` and `event<T>()` do not exist.

- [ ] **Step 3: Implement primitive**

Implement ordered subscriber registration, unsubscribe, snapshot subscriber list before emit, and sequential awaited callback execution. Keep failure isolation behavior currently guaranteed by the event bus.

- [ ] **Step 4: Define named channels and migrate producers/consumers**

Replace string event maps and `.on/.setupListener` calls with named channels and `.subscribe`. Preserve PR merge action ordering through the typed channel implementation or separate typed collect/present channels.

- [ ] **Step 5: Run event tests and module tests**

Run: `npx vitest run test/events.test.ts test/herdr test/pr test/todoist test/worktree test/exit-protocol`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/events.ts src/shared/constants.ts src/herdr src/pr src/todoist src/worktree src/exit-protocol src/footer src/event-consumer.ts test/events.test.ts
git commit -m "refactor: replace string events with typed channels"
```

---

### Task 3: Establish SessionState Git State and Snapshot Updates

**Files:**
- Modify: `src/state.ts`, `src/shared/events.ts`, `src/event-consumer.ts`
- Create: `src/shared/session-state.ts` for `GitState` and snapshot-related shared contracts
- Test: `test/root-state.test.ts`, `test/session-state.test.ts`, `test/events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GitState {
    remoteOrigin?: string;
    branch?: string | null;
    isWorktree?: boolean;
    worktreeRoot?: string | null;
    mainRoot?: string | null;
    hasUncommittedChanges?: boolean;
  }

  export interface SessionState {
    sessionId: string | null;
    gitState: GitState;
    moduleState: Record<string, unknown>;
  }

  export interface ModuleStateChangedEvent {
    moduleId: string;
    moduleState: Record<string, unknown>;
    gitStatePatch?: Partial<GitState>;
  }

  export interface SessionStateChangedEvent {
    previousState: SessionState;
    currentState: SessionState;
  }
  ```
- Root helper:
  ```ts
  function applyModuleStateChanged(
    sessionState: SessionState,
    update: ModuleStateChangedEvent,
  ): Promise<void>;
  ```

- [ ] **Step 1: Add failing snapshot tests**

Test that applying a module update:

1. preserves the stable `SessionState` object identity;
2. deep-copies `previousState` before mutation;
3. deep-copies `currentState` after mutation;
4. emits `sessionStateChangedEvent` containing both snapshots;
5. applies `gitStatePatch` atomically with module state.

Mutate nested data in callback and verify root state/sibling snapshot is unchanged.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run test/root-state.test.ts test/session-state.test.ts test/events.test.ts`

Expected: FAIL because `gitState` and snapshot channel are absent.

- [ ] **Step 3: Add contracts and root consumer**

Construct `{ sessionId: null, gitState: {}, moduleState: {} }`. In root consumer, execute:

```ts
const previousState = structuredClone(sessionState);
applyModuleState(sessionState, update);
const currentState = structuredClone(sessionState);
await eventHandler.sessionStateChangedEvent.emit({ previousState, currentState });
```

Do not replace the stable `sessionState` reference.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/root-state.test.ts test/session-state.test.ts test/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/shared/session-state.ts src/shared/events.ts src/event-consumer.ts test/root-state.test.ts test/session-state.test.ts test/events.test.ts
git commit -m "feat: emit typed session state snapshots"
```

---

### Task 4: Refactor PR Module Ownership

**Files:**
- Modify: `src/pr/state.ts`, `src/pr/commands.ts`, `src/pr/event-consumers.ts`, `src/pr/event-publishers.ts`, `src/pr/module.ts`
- Modify: `src/shared/work-state.ts` only if persisted projection remains there
- Delete PR-related logic from `src/application/event-handlers.ts` and `src/application/lifecycle.ts`
- Test: `test/pr/*`, `test/extensions/pi-todo-gate.test.ts`

**Interfaces:**
- `PrModule` constructor/factory receives `PromptQueue`, `EventHandler`, `SessionState`, PI command registration dependency, and PR-specific dependencies.
- PR-specific state lives in `PrState` and includes remote origin, pinned PR, discovery eligibility/tested URLs, operation generation, and merge metadata.
- `isCurrentMerge` accepts PR-owned state plus session identity/generation values; it does not accept `ExtensionState` or a root runtime adapter.

- [ ] **Step 1: Add failing ownership tests**

Add tests that invoke PR module discovery and merge guards using only PR dependencies, `SessionState`, and typed event channels. Verify remote-origin success emits `moduleStateChangedEvent` with `gitStatePatch.remoteOrigin`.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run test/pr test/extensions/pi-todo-gate.test.ts -t 'remote origin|merge|PR'`

Expected: FAIL because discovery and merge logic still depend on root/session adapters.

- [ ] **Step 3: Move and simplify PR logic**

Move remote-origin inspection, `isCurrentMerge`, PR discovery flags, and PR state projection into PR facets. Replace root-state imports with `SessionState` only where required. Subscribe to `sessionStateChangedEvent` only for shared Git values.

- [ ] **Step 4: Wire PR constructor and events**

Construct PR module once in `main.ts`; register command handlers through the module’s captured narrow dependencies. PR emits typed state updates; it never receives `ExtensionState` at registration.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run test/pr test/extensions/pi-todo-gate.test.ts -t 'remote origin|merge|PR'`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pr src/shared/work-state.ts test/pr test/extensions/pi-todo-gate.test.ts
git commit -m "refactor: move PR state and discovery into PR module"
```

---

### Task 5: Refactor Worktree, Todoist, Footer, and Exit Modules

**Files:**
- Modify: `src/worktree/event-consumers.ts`, `src/worktree/module.ts`, `src/worktree/state.ts`
- Modify: `src/todoist/event-consumers.ts`, `src/todoist/completion.ts`, `src/todoist/module.ts`, `src/todoist/state.ts`
- Modify: `src/footer/event-consumers.ts`, `src/footer/module.ts`, `src/footer/state.ts`
- Modify: `src/exit-protocol/event-consumers.ts`, `src/exit-protocol/module.ts`, `src/exit-protocol/state.ts`
- Test: module-specific tests and integration tests

**Interfaces:**
- Each module constructor receives `PromptQueue`, `EventHandler`, and `SessionState` plus narrow module dependencies.
- Worktree owns status inspection and emits typed footer/module state events.
- Todoist owns claim operation state and subscribes to `sessionResetEvent` to clear it.
- Footer and Exit Protocol subscribe to typed channels and own their private UI/action state.

- [ ] **Step 1: Add failing module ownership tests**

Test Worktree status refresh without root runtime; Todoist claim reset from `sessionResetEvent`; Footer and Exit Protocol listener registration with shared references; and module-state update emission.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run test/worktree test/todoist test/footer test/exit-protocol test/integration`

Expected: FAIL because current consumers still depend on root adapters/string events.

- [ ] **Step 3: Move Worktree status logic**

Move `initializeWorkingTreeStatus` and dirty-status refresh into Worktree. Use `sessionState.gitState` and typed state/footer events. Remove direct root writes.

- [ ] **Step 4: Move Todoist reset/completion state**

Move claim reset into Todoist event consumer. Replace root `taskClaim` access with Todoist-owned state. Keep completion stale guards inside Todoist.

- [ ] **Step 5: Finish Footer and Exit Protocol constructor wiring**

Use injected queue/event/session references functionally. Remove ceremonial ignored constructor fields. Preserve footer persistence and exit action ordering.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run test/worktree test/todoist test/footer test/exit-protocol test/integration`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worktree src/todoist src/footer src/exit-protocol test/worktree test/todoist test/footer test/exit-protocol test/integration
git commit -m "refactor: isolate module state and lifecycle listeners"
```

---

### Task 6: Move Root Lifecycle Coordination and Delete `src/application/`

**Files:**
- Modify: `src/event-consumer.ts`, `src/event-publishers.ts`, `src/main.ts`
- Create: `src/event-publishers.ts`
- Delete: `src/application/event-handlers.ts`, `src/application/lifecycle.ts`, `src/application/session.ts`, then delete empty `src/application/`
- Modify: persisted-state projection helpers and root tests
- Test: `test/extensions/pi-todo-gate.test.ts`, `test/extension-session.test.ts`

**Interfaces:**
- Root consumer accepts a narrow composition object assembled only in `main.ts`; it does not import `ExtensionState`.
- Root publishers expose typed functions such as:
  ```ts
  publishSessionReset(events: EventHandler): Promise<void>;
  publishSessionActivated(events: EventHandler, payload: SessionActivatedEvent): Promise<void>;
  publishSessionDeactivated(events: EventHandler): Promise<void>;
  publishWorkingTreeRefresh(events: EventHandler, payload: RefreshWorkingTreeEvent): Promise<void>;
  ```
- Root owns PromptQueue reset and complete SessionState clearing.

- [ ] **Step 1: Add failing lifecycle tests**

Verify native session-start/shutdown flow resets PromptQueue, emits typed reset/deactivation events, clears `sessionId`, clears `gitState`, clears `moduleState`, and leaves the same SessionState object available.

- [ ] **Step 2: Run lifecycle tests**

Run: `npx vitest run test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts`

Expected: FAIL because lifecycle still lives in `src/application/` and state adapters remain.

- [ ] **Step 3: Move session start/shutdown orchestration**

Move config loading, persisted-state loading, handoff handling, native tool registration, and shutdown sequencing into root `event-consumer.ts`. Root emits typed lifecycle commands; modules respond through subscriptions.

- [ ] **Step 4: Move root publishers**

Create `src/event-publishers.ts` for typed lifecycle/action events. Keep PR discovery, Worktree status, and Todoist reset inside their modules.

- [ ] **Step 5: Remove compatibility state**

Delete `SessionContext`, WeakMap/session adapters, `ApplicationContext`, runtime wrappers, and direct `sessionState.moduleState` writes outside the root state consumer. Replace all imports with `SessionState` or module-local contracts.

- [ ] **Step 6: Delete application folder and update structure checks**

Remove `src/application/` and any dependency-cruiser references. Add a test asserting the directory is absent.

- [ ] **Step 7: Run lifecycle/integration tests**

Run: `npx vitest run test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/event-consumer.ts src/event-publishers.ts src/main.ts test/extension-session.test.ts test/extensions/pi-todo-gate.test.ts
 git rm -r src/application
git commit -m "refactor: move lifecycle coordination to root consumers"
```

---

### Task 7: Enforce Root-State Import Boundary

**Files:**
- Modify: `src/lint/rules/no-extension-state-in-modules.ts`, `src/lint/index.ts`, `src/lint/types.ts`
- Test: `test/lint/no-extension-state-in-modules.test.ts`
- Modify: all scoped module imports reported by the new rule

**Interfaces:**
- Rule ID: `no-root-state-imports-in-modules`.
- Scoped-module imports from root `state.ts` may import `SessionState` only.
- Imports of `ExtensionState`, `SessionContext`, root application types, and root state helpers are diagnostics.
- `main.ts` remains allowed to import `ExtensionState`.

- [ ] **Step 1: Expand failing lint tests**

Test rejection of:

```ts
import type { ExtensionState } from "../state.ts";
import type { SessionContext } from "../state.ts";
import { applyStatePatch } from "../state.ts";
```

Test allowance of:

```ts
import type { SessionState } from "../state.ts";
```

- [ ] **Step 2: Run focused lint tests**

Run: `npx vitest run test/lint/no-extension-state-in-modules.test.ts`

Expected: FAIL for missing SessionContext/helper diagnostics.

- [ ] **Step 3: Implement rule**

Resolve imports to root `state.ts`, inspect named bindings, allow only `SessionState`, and emit one diagnostic per forbidden binding. Cover every scoped module directory.

- [ ] **Step 4: Fix all reported imports**

Move reusable contracts to shared/module state files and update imports. No scoped module may import `ExtensionState`, `SessionContext`, or root adapters.

- [ ] **Step 5: Run lint tests**

Run: `npx vitest run test/lint/no-extension-state-in-modules.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lint src/*/state.ts src/*/module.ts src/*/event-consumers.ts test/lint/no-extension-state-in-modules.test.ts
git commit -m "lint: enforce session state import boundary"
```

---

### Task 8: Final Architecture and Behavior Gate

**Files:**
- Modify: `.dependency-cruiser.cjs`, `scripts/check-module-structure.ts`, architecture/lint tests only where required by completed migration
- Test: full suite

**Interfaces:**
- No `src/application/` directory.
- No `ActiveSession`, `ExtensionRuntime`, `SessionContext`, `ApplicationContext`, or runtime compatibility adapters.
- `ExtensionState` construction appears only in `src/main.ts`.
- All module events use shared typed `Event<T>` channels.

- [ ] **Step 1: Add final structural assertions**

Add tests/ checks for absent application directory, no forbidden identifiers/imports, no sibling-module imports, typed event usage, and stable SessionState construction.

- [ ] **Step 2: Run architecture checks**

Run: `npm run architecture`

Expected: PASS with no dependency violations and no structure issues.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands exit 0; test summary reports all non-skipped tests passing.

- [ ] **Step 4: Review diff and status**

Run:

```bash
rg -n 'ActiveSession|ExtensionRuntime|SessionContext|ApplicationContext|shared/prompt-queue|\.on\(|setupListener' src extensions test
git status --short
```

Expected: no forbidden architecture identifiers/APIs in production code, and clean worktree.

- [ ] **Step 5: Commit final fixes**

```bash
git add .
git commit -m "refactor: complete extension state architecture"
```

- [ ] **Step 6: Push feature branch and update PR**

```bash
git push origin cleanup-root-files
```

Update PR #40 summary with final architecture, tests, and any intentionally retained shared worker utilities.
