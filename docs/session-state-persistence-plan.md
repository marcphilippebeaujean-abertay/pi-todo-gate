# Typed Session State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated `WorkState` and untyped module projections with one typed, namespaced, reloadable `SessionState` snapshot.

**Architecture:** Root-owned `SessionState` contains session metadata, `GitState`, and a fully initialized typed `ModuleState` map. A dedicated persistence module serializes/restores complete snapshots through per-module descriptors. Scoped modules keep runtime handles private and publish typed updates through module-bound publishers.

**Tech Stack:** TypeScript 6, Vitest, Biome, custom TypeScript lint rules, dependency-cruiser, Pi extension event channels.

**Spec:** `docs/session-state-persistence-design.md`

## Global Constraints

- Delete `WorkState`, `PrWorkState`, `WORK_STATE_KEYS`, `applyStatePatch`, flat state parsing, `appendState()`, and `SessionRecord.state`; do not add compatibility aliases.
- Persist only namespaced snapshots with `schemaVersion: 1`; do not implement migration or legacy-format fallback.
- Persist JSON-compatible declarative state only; runtime contexts, functions, promises, timers, workers, queues, generations, and object references stay runtime-only.
- Keep `activeSessionId` runtime-only; persist `inheritedFromSessionId`.
- Keep scoped modules independent; `src/shared` must not import scoped modules and scoped modules must not import one another.
- Every module slice must be initialized, typed, validated, and owned by exactly one module.
- `prDiscoveryTestedUrls` is a deduplicated `string[]`, never a persisted `Set`.
- Durable updates append one complete application snapshot; transient updates update memory only.
- Run targeted tests after each task and commit each independently testable task.

---

## File map

- `src/state.ts` — root-owned `SessionState`, `ModuleState` DTOs, `SessionMetadata`, `GitState` composition, and initial state.
- `src/shared/session-state.ts` — runtime-only `SessionRecord` and `SessionReader`; no persisted `WorkState` types.
- `src/session-state-persistence.ts` — persisted DTO, JSON value type, descriptor registry, serialization, restore, and latest-snapshot parsing.
- `src/shared/events.ts` — correlated module update events and session-state snapshot event types.
- `src/event-consumer.ts` — root update application, durable snapshot callback, session lifecycle state assignment.
- `src/event-publishers.ts` — root lifecycle publishers; module-bound state publishers may be added here or beside module publishers.
- `src/pr/state.ts`, `src/todoist/state.ts`, `src/herdr/state.ts`, `src/worktree/state.ts`, `src/footer/state.ts`, `src/exit-protocol/state.ts` — module DTO aliases/descriptors and runtime interfaces.
- Each module's `event-publishers.ts` — module-bound typed state publishers.
- Each module's `event-consumers.ts` and `module.ts` — read aggregate slices, publish owned updates, and rebind runtime state.
- `src/lint/rules/no-nonserializable-module-state.ts` — static serializability rule.
- `src/lint/rules/no-direct-module-state-write.ts` — direct-write ownership rule if separate from the existing root-state boundary rule.
- `test/session-state.test.ts` — aggregate defaults and runtime record contract tests.
- `test/session-state-persistence.test.ts` — persistence/restore/descriptor tests.
- `test/root-state.test.ts` — typed updates, durable append behavior, and snapshot events.
- module tests — ownership and reload behavior for each module.
- lint tests — serializability and ownership-rule coverage.

---

### Task 1: Replace state contracts and initialize typed module slices

**Files:**
- Modify: `src/state.ts`
- Modify: `src/shared/session-state.ts`
- Modify: `src/shared/events.ts`
- Test: `test/session-state.test.ts`
- Test: `test/root-state.test.ts`

**Interfaces:**
- Produces `SessionMetadata`, `ModuleState`, typed module DTOs, `SessionState`, and `createSessionState()`.
- Produces runtime-only `SessionRecord` without `sessionId` or `state`.
- Consumers continue importing `SessionRecord` from `src/shared/session-state.ts` and `SessionState` from `src/state.ts`.

- [ ] **Step 1: Write failing aggregate contract tests**

Add tests that assert `createSessionState()` returns:

```ts
{
  session: { activeSessionId: null },
  gitState: {},
  moduleState: {
    pr: { discoveryDisabled: false, discoveryTestedUrls: [], mergedPrs: [] },
    todoist: {},
    herdr: {},
    worktree: {},
    footer: { footers: {} },
    exitProtocol: { active: false }
  }
}
```

Add a compile-facing fixture showing `SessionState["moduleState"]["pr"]` is the PR public DTO and cannot accept Todoist fields.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npx vitest run test/session-state.test.ts test/root-state.test.ts`

Expected: FAIL because current state has `sessionId`, untyped `{}`, and `WorkState`-based fields.

- [ ] **Step 3: Implement root state contracts**

In `src/state.ts`:

- Define `SessionMetadata` with `activeSessionId: string | null` and optional `inheritedFromSessionId`.
- Define root-owned serializable DTOs for `PrModuleState`, `TodoistModuleState`, `HerdrModuleState`, `WorktreeModuleState`, `FooterModuleState`, and `ExitProtocolModuleState`.
- Define `ModuleState` with required keys for all six modules.
- Define `SessionState` with `session`, `gitState`, and `moduleState`.
- Move `remoteOrigin` and `mergeCompletedAt` into `GitState`.
- Initialize every module slice in `createSessionState()`.
- Remove `WorkState`, flat state parsing, `WORK_STATE_KEYS`, `isWorkState`, `latestState`, `extractInheritedState`, and `emptyWorkState` from root exports.

In `src/shared/session-state.ts`:

- Remove `WorkState` and `PrWorkState` dependencies.
- Remove `sessionId` and `state` from `SessionRecord`.
- Retain only runtime coordination/configuration fields and `SessionReader`.

Update `SessionStateSnapshot` and event imports to use the new aggregate shape without creating a shared-to-scoped dependency.

- [ ] **Step 4: Run targeted tests and typecheck**

Run: `npx vitest run test/session-state.test.ts test/root-state.test.ts && npm run typecheck`

Expected: new contract tests pass; existing consumers may fail to compile until later migration tasks. Record remaining compiler failures by module.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/shared/session-state.ts src/shared/events.ts test/session-state.test.ts test/root-state.test.ts
git commit -m "refactor: define typed session state aggregate"
```

---

### Task 2: Add dedicated snapshot persistence and descriptor restoration

**Files:**
- Create: `src/session-state-persistence.ts`
- Create: `test/session-state-persistence.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `ModuleState`, `ModuleId`, and `createSessionState()` from Task 1.
- Produces `PersistedSessionState`, `JsonValue`, `ModuleStateDescriptor`, `serializeSessionState()`, `restoreSessionState()`, and `latestPersistedSessionState()`.

- [ ] **Step 1: Write failing persistence tests**

Cover:

```ts
const serialized = serializeSessionState(state);
expect(serialized).toEqual({
  schemaVersion: 1,
  session: { inheritedFromSessionId: "previous" },
  gitState: expect.any(Object),
  moduleState: expect.objectContaining({ pr: expect.any(Object) })
});
expect(serialized).not.toHaveProperty("session.activeSessionId");
```

Also cover full round-trip, malformed root fallback, malformed single-module fallback, unsupported schema version, and deduplication of `pr.discoveryTestedUrls`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run test/session-state-persistence.test.ts`

Expected: FAIL because persistence module does not exist.

- [ ] **Step 3: Implement generic persistence**

Implement:

```ts
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export interface PersistedSessionState {
  schemaVersion: 1;
  session: { inheritedFromSessionId?: string };
  gitState: GitState;
  moduleState: ModuleState;
}

export interface ModuleStateDescriptor<K extends ModuleId> {
  id: K;
  createInitialState(): ModuleState[K];
  restore(value: unknown): ModuleState[K];
  serialize(state: ModuleState[K]): JsonValue;
}
```

`serializeSessionState()` must omit `activeSessionId` and serialize each slice through its descriptor. `restoreSessionState()` must start from `createSessionState()`, validate the root envelope and version, restore each slice independently, and preserve defaults for invalid slices. Normalize PR tested URLs to unique non-empty strings.

`latestPersistedSessionState()` must scan newest-to-oldest entries and accept only custom entries with `customType === "pi-todo-gate-state"`, `schemaVersion === 1`, and the namespaced envelope. Do not parse old flat entries.

- [ ] **Step 4: Run persistence tests and typecheck**

Run: `npx vitest run test/session-state-persistence.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session-state-persistence.ts test/session-state-persistence.test.ts
git commit -m "feat: add namespaced session state persistence"
```

---

### Task 3: Correlate module updates and add durable snapshot writes

**Files:**
- Modify: `src/shared/events.ts`
- Modify: `src/event-consumer.ts`
- Modify: `src/event-publishers.ts`
- Modify: `src/state.ts`
- Modify: `test/root-state.test.ts`
- Modify: `test/events.test.ts`

**Interfaces:**
- Consumes: `ModuleState`, `ModuleId`, `PersistedSessionState`, and persistence functions from Tasks 1–2.
- Produces correlated `ModuleStateChangedEvent`, generic `updateModuleState()`, `registerModuleStateConsumer()`, and a durable snapshot callback.

- [ ] **Step 1: Write failing typed-update tests**

Test that:

- a PR update changes only `moduleState.pr`;
- a Todoist update changes only `moduleState.todoist`;
- each update is structured-cloned;
- `persist: false` does not append;
- `persist: true` appends one complete namespaced snapshot;
- `gitStatePatch` updates only `gitState`;
- concurrent updates remain serialized.

Use a typed discriminated update union so `{ moduleId: "pr", moduleState: todoistState }` fails typechecking.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx vitest run test/root-state.test.ts test/events.test.ts`

Expected: FAIL because events currently carry `string` plus `Record<string, unknown>` and have no durable flag.

- [ ] **Step 3: Implement correlated events and root updater**

Define:

```ts
type ModuleStateUpdate = {
  [K in ModuleId]: {
    moduleId: K;
    moduleState: ModuleState[K];
    persist: boolean;
  }
}[ModuleId];
```

Update event channels to carry this union. Keep Git updates explicit and typed. Make `updateModuleState()` assign only the addressed typed slice. Extend `registerModuleStateConsumer()` to call an injected `persistSessionState` callback only for durable updates after the aggregate update succeeds.

Add root-facing bound publisher construction so each module receives a publisher fixed to its own `moduleId`.

- [ ] **Step 4: Run targeted tests and typecheck**

Run: `npx vitest run test/root-state.test.ts test/events.test.ts && npm run typecheck`

Expected: PASS for root/event tests; migrated module call sites remain the only typecheck failures.

- [ ] **Step 5: Commit**

```bash
git add src/shared/events.ts src/event-consumer.ts src/event-publishers.ts src/state.ts test/root-state.test.ts test/events.test.ts
git commit -m "feat: type module updates and durable snapshots"
```

---

### Task 4: Migrate PR module state

**Files:**
- Modify: `src/pr/state.ts`
- Modify: `src/pr/module.ts`
- Modify: `src/pr/event-consumers.ts`
- Modify: `src/pr/event-publishers.ts`
- Modify: `src/pr/state-tool.ts`
- Modify: `src/pr/commands.ts`
- Modify: `src/pr/parsing.ts`
- Modify: `src/event-consumer.ts`
- Modify: `test/pr/module.test.ts`
- Modify: `test/pr/merge-protocol.test.ts`
- Modify: `test/pr/merge-detection.test.ts`

**Interfaces:**
- Consumes: `SessionState.moduleState.pr`, `gitState`, and PR-bound state publisher.
- Produces: PR descriptor, restored PR state, and no `PrWorkState`/`session.state` references.

- [ ] **Step 1: Add failing PR ownership tests**

Add tests proving PR URL, discovery eligibility, merged PRs, and tested URL arrays live in `sessionState.moduleState.pr`, survive restore, and publish only PR updates. Assert PR operations read Todoist task identity only through `sessionState.moduleState.todoist` where needed.

- [ ] **Step 2: Run PR tests and confirm failure**

Run: `npx vitest run test/pr test/pr/merge-protocol.test.ts`

Expected: FAIL on old `session.state`, `PrWorkState`, and `Set` assumptions.

- [ ] **Step 3: Migrate PR code**

- Replace `PrWorkState` with the root-owned PR DTO and `gitState` access.
- Remove `state` and `allowPrDiscovery` from `PrSession` usage.
- Replace `prDiscoveryTestedUrls: Set<string>` with `moduleState.pr.discoveryTestedUrls: string[]` and `includes()` checks.
- Remove persisted PR URL copies from Todoist-facing PR projections.
- Move PR operation generations to private runtime fields.
- Make state-tool set/clear operations update only the PR slice and mark durable snapshots.
- Implement PR descriptor restore/serialize normalization.

- [ ] **Step 4: Run PR tests and typecheck**

Run: `npx vitest run test/pr test/pr/merge-protocol.test.ts && npm run typecheck`

Expected: PR tests pass; remaining failures belong to unmigrated modules/root lifecycle.

- [ ] **Step 5: Commit**

```bash
git add src/pr src/event-consumer.ts test/pr test/pr/merge-protocol.test.ts test/pr/merge-detection.test.ts
git commit -m "refactor: move PR state into typed session state"
```

---

### Task 5: Migrate Todoist and Herdr state

**Files:**
- Modify: `src/todoist/state.ts`
- Modify: `src/todoist/module.ts`
- Modify: `src/todoist/event-consumers.ts`
- Modify: `src/todoist/completion.ts`
- Modify: `src/herdr/module.ts`
- Modify: `src/herdr/state.ts`
- Modify: `src/main.ts`
- Modify: `test/todoist/module.test.ts`
- Modify: `test/integration/todoist-merge-consumer.test.ts`
- Modify: `test/herdr/tab-claim.test.ts`
- Modify: `test/herdr/claim-worker.test.ts`

**Interfaces:**
- Consumes: typed Todoist/Herdr slices, PR slice reads, and bound publishers.
- Produces: Todoist and Herdr descriptors and durable task/claim updates.

- [ ] **Step 1: Add failing Todoist/Herdr ownership tests**

Test that task identity and completion-attempt timestamps are stored only in `moduleState.todoist`, Herdr claim status only in `moduleState.herdr`, and task claims read the PR URL from `moduleState.pr`.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npx vitest run test/todoist test/integration/todoist-merge-consumer.test.ts test/herdr`

Expected: FAIL on `session.state` and flat Herdr marker access.

- [ ] **Step 3: Migrate Todoist and Herdr**

- Remove Todoist task fields from `WorkState`-style interfaces.
- Read/write task slices through the root aggregate.
- Replace `applyStatePatch()` calls with immutable typed Todoist updates.
- Mark task assignment, completion attempts, and Herdr claim completion durable.
- Keep claim pending/completed/session references runtime-only.
- Add module descriptors and default states.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/todoist test/integration/todoist-merge-consumer.test.ts test/herdr && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/todoist src/herdr src/main.ts test/todoist test/integration/todoist-merge-consumer.test.ts test/herdr
git commit -m "refactor: move Todoist and Herdr state into session state"
```

---

### Task 6: Migrate Git, Worktree, Footer, and Exit Protocol state

**Files:**
- Modify: `src/worktree/state.ts`
- Modify: `src/worktree/module.ts`
- Modify: `src/worktree/event-consumers.ts`
- Modify: `src/worktree/event-publishers.ts`
- Modify: `src/footer/state.ts`
- Modify: `src/footer/module.ts`
- Modify: `src/footer/event-consumers.ts`
- Modify: `src/footer/event-publishers.ts`
- Modify: `src/exit-protocol/state.ts`
- Modify: `src/exit-protocol/event-consumers.ts`
- Modify: `src/exit-protocol/event-publishers.ts`
- Modify: `test/worktree/module.test.ts`
- Modify: `test/footer/module.test.ts`
- Modify: `test/exit-protocol/module.test.ts`
- Modify: `test/footer/render.test.ts`

**Interfaces:**
- Consumes: `gitState`, typed worktree/footer/exit-protocol slices, and bound publishers.
- Produces: Git and UI state descriptors with runtime-only picker/animation values excluded.

- [ ] **Step 1: Add failing Git/UI state tests**

Test that remote origin, merge timestamp, branch, worktree paths, and dirty status update `gitState`; footer rendering reads PR/task data from typed module slices; footer and exit protocol publish only their own slices.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npx vitest run test/worktree test/footer test/exit-protocol`

Expected: FAIL on old `gitStatePatch` shapes, `SessionRecord.state`, and module-local persisted footer assumptions.

- [ ] **Step 3: Migrate modules**

- Route remote origin and merge timestamp through `gitState`.
- Keep live filesystem status refreshes externally derived; classify durable Git changes explicitly.
- Convert footer persisted state into the common descriptor format.
- Keep animation timers, TUI objects, and picker `Set`s runtime-only.
- Make footer renderers read `moduleState.pr`, `moduleState.todoist`, and `gitState` rather than `SessionRecord.state`.
- Reset module slices through root updates on deactivation.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/worktree test/footer test/exit-protocol && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worktree src/footer src/exit-protocol test/worktree test/footer test/exit-protocol
git commit -m "refactor: move Git and UI state into session state"
```

---

### Task 7: Integrate lifecycle, handoff, reload, and full snapshot persistence

**Files:**
- Modify: `src/event-consumer.ts`
- Modify: `src/main.ts`
- Modify: `src/event-publishers.ts`
- Modify: `src/shared/session-state.ts`
- Modify: `test/extension-session.test.ts`
- Modify: `test/root-state.test.ts`
- Modify: `test/session-state-persistence.test.ts`
- Modify: `test/integration/todoist-merge-consumer.test.ts`

**Interfaces:**
- Consumes: all module descriptors and bound publishers from Tasks 2–6.
- Produces: activation that restores the aggregate before module activation, current `activeSessionId`, and namespaced handoff behavior.

- [ ] **Step 1: Add failing lifecycle tests**

Cover:

- current namespaced snapshot restores before `sessionActivatedEvent` handlers run;
- current context supplies `activeSessionId`;
- previous-session handoff restores namespaced state and sets `inheritedFromSessionId`;
- `hasPendingHandoffContext` is runtime-only and clears after prompt delivery;
- deactivation clears the aggregate and runtime record;
- durable module updates append complete snapshots.

- [ ] **Step 2: Run lifecycle tests and confirm failure**

Run: `npx vitest run test/extension-session.test.ts test/root-state.test.ts test/session-state-persistence.test.ts`

Expected: FAIL while lifecycle still calls flat `latestState()`, `appendState()`, and copies fields into `SessionRecord.state`.

- [ ] **Step 3: Integrate restore/persist lifecycle**

- Replace `latestState()` with `latestPersistedSessionState()`.
- Restore current branch state before constructing/activating module runtime bindings.
- Set `session.activeSessionId` from `ctx.sessionManager.getSessionId()`.
- On eligible previous-session handoff, restore the previous namespaced snapshot and assign `inheritedFromSessionId` from `SessionReader.getSessionId()`.
- Replace every `appendState()` call with explicit durable snapshot persistence.
- Ensure reset/deactivation clears all initialized slices and runtime-only state.
- Update before-agent prompts, merge guards, state tools, and Herdr callbacks to read aggregate slices.

- [ ] **Step 4: Run lifecycle tests and typecheck**

Run: `npx vitest run test/extension-session.test.ts test/root-state.test.ts test/session-state-persistence.test.ts test/integration/todoist-merge-consumer.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/event-consumer.ts src/main.ts src/event-publishers.ts src/shared/session-state.ts test/extension-session.test.ts test/root-state.test.ts test/session-state-persistence.test.ts test/integration/todoist-merge-consumer.test.ts
git commit -m "refactor: restore and persist complete session snapshots"
```

---

### Task 8: Add serializability and direct-write lint enforcement

**Files:**
- Create: `src/lint/rules/no-nonserializable-module-state.ts`
- Modify: `src/lint/index.ts`
- Modify: `src/lint/types.ts` to register both rule IDs
- Create: `src/lint/rules/no-direct-module-state-write.ts`
- Create: `test/lint/no-nonserializable-module-state.test.ts`
- Create: `test/lint/no-direct-module-state-write.test.ts`

**Interfaces:**
- Consumes: root-owned `ModuleState` declarations and module update APIs.
- Produces: lint diagnostics for non-serializable DTOs and direct/cross-module writes.

- [ ] **Step 1: Write failing lint tests**

Accepted fixture:

```ts
interface PrModuleState {
  prUrl?: string;
  discoveryTestedUrls: string[];
}
```

Rejected fixtures:

```ts
interface BadState {
  pending: Promise<void>;
  seen: Set<string>;
  callback: () => void;
  context: ExtensionContext;
}
```

Add cross-module write fixtures where a PR module writes `moduleState.todoist` or root code assigns a module slice directly outside the root updater.

- [ ] **Step 2: Run lint tests and confirm failure**

Run: `npx vitest run test/lint/no-nonserializable-module-state.test.ts test/lint/no-direct-module-state-write.test.ts`

Expected: FAIL because the new rules are not registered.

- [ ] **Step 3: Implement and register rules**

Use TypeScript AST inspection to traverse public module-state declarations and reject explicit runtime-only syntax/names. Keep diagnostics deterministic and report one diagnostic per offending property/binding. Extend existing root-state/module-boundary tests rather than weakening the current rule.

- [ ] **Step 4: Run lint tests and full strict lint**

Run: `npx vitest run test/lint && npm run lint:strict`

Expected: PASS with no diagnostics from production code.

- [ ] **Step 5: Commit**

```bash
git add src/lint test/lint
git commit -m "lint: enforce serializable owned module state"
```

---

### Task 9: Remove legacy references and run full verification

**Files:**
- Modify: any remaining files reported by `rg`
- Modify: affected tests and fixtures

**Interfaces:**
- Consumes: completed aggregate, persistence, lifecycle, module, and lint changes.
- Produces: repository-wide removal of the old state architecture.

- [ ] **Step 1: Scan for forbidden legacy symbols**

Run:

```bash
rg -n "\b(WorkState|PrWorkState|WORK_STATE_KEYS|applyStatePatch|appendState|latestState|extractInheritedState)\b|session\.state|\.state\.prUrl|\.state\.taskRef" src extensions test
```

Expected: no production references; test references exist only where the test intentionally checks removed behavior and must be rewritten.

- [ ] **Step 2: Remove remaining legacy references**

Replace every remaining flat-state fixture with a namespaced `PersistedSessionState` fixture. Remove obsolete tests for flat parsing and add explicit unsupported-format tests where useful.

- [ ] **Step 3: Run architecture, tests, lint, and typecheck**

Run:

```bash
npm test
npm run lint
npm run typecheck
git diff --check
git status --short --branch
```

Expected:

- dependency-cruiser and module-structure checks pass;
- all Vitest tests pass;
- Biome and strict lint pass;
- TypeScript emits no errors;
- diff check passes;
- only intended commits/working tree state remain.

- [ ] **Step 4: Commit cleanup**

```bash
git add src extensions test
git commit -m "refactor: remove legacy work state architecture"
```

## Self-review checklist

- [x] Spec coverage: state ownership, typed map, persistence, descriptors, reload, handoff, explicit durability, linting, tests, and deletion of `WorkState` each have dedicated tasks.
- [x] No migration or legacy fallback is included.
- [x] `activeSessionId` is runtime-only; `inheritedFromSessionId` is persisted.
- [x] `prDiscoveryTestedUrls` is an array throughout persisted/public state.
- [x] Task interfaces name concrete files, test commands, produced types, and commit boundaries.
- [x] Intermediate typecheck failures are expected only while later migration tasks are incomplete.
- [x] No placeholder markers or unspecified implementation step remains.
