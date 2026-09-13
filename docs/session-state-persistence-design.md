# Session State Persistence and Typed Module State

## Status

Proposed design for follow-up implementation after PR #40.

## Context

The extension currently has two overlapping state representations:

- `SessionRecord.state: WorkState` stores the active workflow state and is used as the authoritative mutable state by PR and Todoist code.
- `SessionState.moduleState: Record<string, unknown>` stores module projections received through events.

This duplicates PR URLs, Todoist task data, and other values. It also forces modules to infer or copy state because scoped modules cannot import one another's state types.

The repository intentionally enforces module boundaries:

- scoped modules must not import one another;
- shared code must not import scoped modules;
- root composition may compose modules;
- modules may share root-owned state contracts.

The replacement makes `SessionState` the single in-memory and persisted application-state aggregate. State is namespaced by owner, strongly typed, JSON-compatible, and restored before module activation.

## Goals

1. Remove duplicated `WorkState` and module projections.
2. Make every resumable application-state field have one canonical owner.
3. Persist one complete, namespaced application snapshot.
4. Restore all module state before modules rebind runtime dependencies.
5. Keep module boundaries intact while allowing typed read access to public state.
6. Prevent accidental cross-module writes through typed update APIs and linting.
7. Keep runtime coordination state separate from persisted declarative state.
8. Make state persistence and restoration generic and independently testable.

## Non-goals

- No migration from the current flat persisted format.
- No compatibility alias for `WorkState`.
- No persistence of runtime handles, queues, contexts, workers, timers, or stale-operation tokens.
- No cross-module runtime imports.
- No attempt to persist arbitrary module implementation objects.

Old flat state entries are unsupported after this refactor. The new parser reads only the namespaced format.

## State model

`src/state.ts` owns the in-memory state contracts and initial state. The old `WorkState` bucket is deleted.

```ts
interface SessionMetadata {
	activeSessionId: string | null;
	inheritedFromSessionId?: string;
}

interface SessionState {
	session: SessionMetadata;
	gitState: GitState;
	moduleState: ModuleState;
}
```

`activeSessionId` is runtime-only. It is assigned from the current `ExtensionContext` during activation and is never restored from persisted data. `inheritedFromSessionId` is persisted handoff provenance.

All module keys are initialized by `createSessionState()`. No module slice is optional at runtime.

### Canonical ownership

| Existing data | New owner |
| --- | --- |
| `prUrl` | `moduleState.pr.prUrl` |
| `allowPrDiscovery` | `moduleState.pr.discoveryDisabled` |
| `prDiscoveryTestedUrls` | `moduleState.pr.discoveryTestedUrls: string[]` |
| `mergedPrs` | `moduleState.pr.mergedPrs` |
| `taskRef`, `taskName`, `taskUrl` | `moduleState.todoist` |
| `todoistCompletionAttemptedAt` | `moduleState.todoist` |
| Todoist merge-prompt metadata | `moduleState.todoist` |
| `remoteOrigin` | `gitState` |
| `mergeCompletedAt` | `gitState` |
| branch/worktree/status data | `gitState` |
| `herdrClaimReturnedSuccessfully` | `moduleState.herdr` |
| `inheritedFrom` | `session.inheritedFromSessionId` |
| active session identity | `session.activeSessionId` |

The same field must not appear in both `gitState`/`moduleState` and another slice. For example, PR URL belongs only to `moduleState.pr`; Todoist task identity belongs only to `moduleState.todoist`.

Module slices contain public, resumable state only. Private runtime values remain inside module instances.

Examples of runtime-only values:

- `ExtensionContext`;
- `Promise` queues;
- worker handles and callbacks;
- timers and UI objects;
- current-session object references;
- lifecycle generations and operation generations;
- mutable `Set`/`Map` caches;
- `hasPendingHandoffContext` and `hasPerformedAnyGitMutations`.

`prDiscoveryTestedUrls` is intentionally an array in persisted/public state. Restore normalizes it to unique strings. Runtime membership checks use `includes()`; expected session cardinality is very small.

## Public module-state contracts

The root owns the aggregate `ModuleState` contract. It may define public DTO interfaces for each module without importing module implementation state objects.

```ts
interface ModuleState {
	pr: PrModuleState;
	todoist: TodoistModuleState;
	herdr: HerdrModuleState;
	worktree: WorktreeModuleState;
	footer: FooterModuleState;
	exitProtocol: ExitProtocolModuleState;
}
```

The exact DTO fields derive from current module projections and the ownership table above. Runtime-only fields such as PR operation generations and exit-picker `Set`s are excluded.

Scoped modules may refer to their own public contract through the root aggregate:

```ts
type PrState = SessionState["moduleState"]["pr"];
```

They do not import another scoped module's state file. Shared code remains unaware of scoped modules.

## Persistence format

Persistence mechanics live in a dedicated root file:

```text
src/state.ts
src/session-state-persistence.ts
```

`src/state.ts` contains in-memory types, initial-state construction, and state contracts. `src/session-state-persistence.ts` contains persistence DTOs, serialization, restore, snapshot parsing, and descriptor orchestration.

The persisted custom entry contains one complete snapshot:

```ts
interface PersistedSessionState {
	schemaVersion: 1;
	session: {
		inheritedFromSessionId?: string;
	};
	gitState: GitState;
	moduleState: ModuleState;
}
```

`activeSessionId` is absent from this DTO. The root sets it from the active Pi context during activation.

Root persistence replaces flat `appendState()` behavior:

```ts
persistSessionState(sessionState);
```

A persisted update appends the complete current snapshot, not a module fragment. This guarantees that the latest valid entry is sufficient to restore the application.

Persistence is explicit. Module updates identify whether they are durable:

```ts
publishPrState(nextState, { persist: true });
publishFooterState(nextState, { persist: false });
```

Durable updates append a complete snapshot. Presentation-only updates update the in-memory aggregate without appending a session entry. Modules must classify externally-derived or transient status accordingly.

## Restore descriptors

Each module supplies a descriptor for its public state:

```ts
interface ModuleStateDescriptor<K extends ModuleId> {
	id: K;
	createInitialState(): ModuleState[K];
	restore(value: unknown): ModuleState[K];
	serialize(state: ModuleState[K]): JsonValue;
}
```

The persistence file accepts descriptors from root composition. It does not import scoped modules directly.

Restore sequence:

1. Find the latest namespaced snapshot in the current branch.
2. Validate `schemaVersion` and the root envelope.
3. Create default state for every module.
4. Restore each module slice through its descriptor.
5. Restore `gitState` through root validation.
6. Restore `inheritedFromSessionId`.
7. Assign `session.activeSessionId` from the current context.
8. Set runtime handoff flags as required by the activation path.
9. Activate modules and rebind runtime dependencies.
10. Refresh values that must be read from the live filesystem, Git, GitHub, or Todoist.

Invalid module data falls back only that module's initial state. Invalid root data falls back to a complete initial snapshot. Restore must never inject arbitrary persisted values directly into module runtime objects.

No legacy flat-state fallback is included.

## Serialization constraints and linting

Persisted/public module state must be JSON-compatible:

```ts
type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };
```

Public module-state contracts and descriptor serializers must satisfy this constraint. `Set<string>` is not valid persisted state; arrays are required.

Add a lint rule, tentatively named `no-nonserializable-module-state`, which rejects runtime-only types reachable from module-state declarations, including:

- `Promise`;
- `Set` and `Map`;
- function types;
- `ExtensionContext`;
- timers and worker handles;
- class instances and other known runtime objects.

The lint rule is a static guard, not the sole validation mechanism. Type constraints catch ordinary declaration errors, lint catches banned patterns, and restore descriptors validate unknown persisted data at runtime.

Add focused lint tests for accepted JSON DTOs and rejected runtime-only declarations.

## Typed update and ownership API

Module IDs and state types are correlated:

```ts
type ModuleId = keyof ModuleState;

type ModuleStateUpdate = {
	[K in ModuleId]: {
		moduleId: K;
		moduleState: ModuleState[K];
		persist: boolean;
	};
}[ModuleId];
```

Root applies updates to the aggregate. Module publishers are bound to their own module ID and accept only their own state type. A PR publisher cannot publish a Todoist slice through the typed API.

Direct assignment to `sessionState.moduleState` is restricted to root state consumers. Scoped modules read a read-only aggregate and publish replacements through their bound updater. Linting rejects direct module-state assignment outside the root update path and rejects scoped modules using another module ID.

Every update replaces one module slice with a structured clone. The aggregate remains the stable root object used by consumers; slice identity changes on accepted updates.

## Session runtime record

`SessionRecord` retains only runtime coordination and session configuration:

```ts
interface SessionRecord {
	context: ExtensionContext;
	project: {
		codingRoot: string;
		todoistProjectRef: string;
		triggersOnlyOnWorktree?: boolean;
	};
	hasPendingHandoffContext: boolean;
	hasPerformedAnyGitMutations: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
}
```

Delete `SessionRecord.state` and its duplicate `sessionId`. Code that needs identity reads `sessionState.session.activeSessionId`. Code that needs workflow/module data reads the typed aggregate.

Delete the old state helpers and types:

- `WorkState`;
- `PrWorkState`;
- `WORK_STATE_KEYS`;
- `applyStatePatch`;
- flat `latestState` and `extractInheritedState` parsing;
- `appendState()`;
- any compatibility aliases retaining the old shape.

Replace flat patches with typed module-slice updates. Replace flat persistence with `persistSessionState()`.

## Handoff behavior

When a new session has no current namespaced snapshot and a previous session is eligible for handoff, root reads the previous session's namespaced snapshot, verifies project compatibility, and restores its declarative state. Root sets `inheritedFromSessionId` from the previous session reader's session ID.

`hasPendingHandoffContext` remains runtime-only. It is set for the activation that consumes inherited state and cleared after the handoff prompt is delivered. It is never restored as a durable flag, preventing repeated handoff prompts on reload.

## Testing and acceptance

Add or update tests for:

1. Every module key being initialized by `createSessionState()`.
2. Full namespaced snapshot serialization and restoration.
3. Exclusion of `activeSessionId` from persisted data.
4. Restoration of `inheritedFromSessionId`.
5. `prDiscoveryTestedUrls` array normalization and deduplication.
6. Invalid root data falling back to defaults.
7. Invalid module slices falling back only that module's defaults.
8. Typed module-ID/state correlation.
9. Bound publishers preventing cross-module writes.
10. `persist: false` producing no append.
11. `persist: true` appending one complete snapshot.
12. Reload restoring state before module activation.
13. Runtime queues, handles, contexts, generations, and references being recreated.
14. No remaining `SessionRecord.state` or `WorkState` references.
15. Lint rejection of non-serializable module-state declarations.
16. Existing module-structure and dependency-boundary checks remaining green.

Acceptance requires that every state value intended to survive reload exists exactly once in `SessionState`, has a typed owner, is JSON-compatible, and is restored through a descriptor. Runtime-only coordination data must not appear in persisted snapshots.

## Implementation boundaries

Expected primary files:

- `src/state.ts` — new aggregate contracts and defaults;
- `src/session-state-persistence.ts` — snapshot persistence and restore;
- `src/event-consumer.ts` — typed root update application and lifecycle integration;
- `src/shared/events.ts` — correlated state-update event types;
- module `state.ts`, `module.ts`, publishers, and consumers — slice ownership and runtime rebinding;
- lint rule and lint tests — serializability and direct-write enforcement;
- existing state, lifecycle, module, integration, and architecture tests.

No implementation is part of this design document. The next step is an implementation plan that breaks the refactor into ordered, verifiable slices.
