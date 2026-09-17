# Session Action Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated stale-session checks around background work with final mutation guards and one notification event routed to the active session.

**Architecture:** Runtime `activeSessionId` remains the lifecycle concurrency token and remains absent from persisted snapshots. A shared session-action helper performs the final pre-dispatch check and returns whether mutation started; callers keep only checks needed before shared-state writes. A root notification router consumes one `{ message, level }` event and delivers it to the current session or queues it through activation gaps.

**Tech Stack:** TypeScript, Vitest, Biome, repository strict lint rules, Pi extension event channels.

**Spec:** `docs/superpowers/specs/2026-09-17-session-action-notifications-design.md`

## Global Constraints

- Keep `activeSessionId` as in-memory runtime concurrency state; it is not serialized.
- Keep `inheritedFromSessionId` as persisted handoff provenance.
- Do not pass originating `ExtensionContext` through notification events.
- Do not block new sessions or shutdown on worker completion.
- Do not claim cancellation or rollback after an external process starts.
- Guard Todoist completion, worktree removal, and local branch deletion immediately before dispatch.
- Preserve sequence checks for out-of-order read-only refresh results.
- Run `npm test`, `npm run lint`, and `npm run typecheck` before completion.

## File Map

- Create `src/shared/session-actions.ts`: typed final-dispatch guard and action outcome.
- Modify `src/shared/events.ts`: notification event payload and event-handler channel.
- Modify `src/event-publishers.ts`: publisher for notification events.
- Modify `src/event-consumer.ts`: route notifications to active UI and queue activation-gap notices.
- Modify `src/todoist/client.ts`, `src/todoist/internal-state.ts`, `src/todoist/completion.ts`: remove per-command cancellation callback and guard only completion dispatch/state synchronization.
- Modify `src/worktree/git.ts`, `src/worktree/internal-state.ts`, `src/worktree/event-consumers.ts`: guard each destructive cleanup command through shared helper.
- Modify `AGENTS.md`: document session-action rule for future agents.
- Modify `test/events.test.ts`, `test/extension-session.test.ts`, `test/todoist/client.test.ts`, `test/integration/todoist-merge-consumer.test.ts`, `test/worktree/module.test.ts`, and add `test/session-actions.test.ts` for focused behavior coverage.

---

### Task 1: Add notification channel and active-session router

**Files:**
- Create: `src/shared/session-actions.ts` only if shared types are needed by the router; otherwise defer to Task 2.
- Modify: `src/shared/events.ts`
- Modify: `src/event-publishers.ts`
- Modify: `src/event-consumer.ts`
- Modify: `test/events.test.ts`
- Modify: `test/extension-session.test.ts`

**Interfaces:**
- Produce `SessionNotificationEvent = { message: string; level: "info" | "warning" }`.
- Produce `EventHandler.sessionNotificationEvent: Event<SessionNotificationEvent>`.
- Produce `publishSessionNotification(eventHandler, message, level): Promise<void>`.

- [ ] **Step 1: Write failing tests**

Add tests proving that a notification event delivered while `root.session` is active calls only the active session's `context.ui.notify(message, level)`, never an originating context. Add a transition test where `root.session` is `null` but `activeSessionId` is set: notification is queued and delivered after `sessionActivatedEvent` for that ID. Add tests that notices are dropped when `activeSessionId` is `null` and after shutdown.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/events.test.ts test/extension-session.test.ts`
Expected: FAIL because notification event and router do not exist.

- [ ] **Step 3: Implement event and routing**

Add notification channel to `createSharedEvents`. Add publisher in the existing publisher module so modules do not call `eventHandler.emit` directly. In `registerExtensionEventConsumers`, subscribe once to notifications. Route immediately to `root.session?.context.ui` through a safe UI notification helper. If no root session exists but `root.sessionState.session.activeSessionId !== null`, queue by that ID. Flush only matching queued notices from `sessionActivatedEvent`; clear queued notices on deactivation/shutdown and when no active session exists. Do not include `ExtensionContext` in payload.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run test/events.test.ts test/extension-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/events.ts src/event-publishers.ts src/event-consumer.ts test/events.test.ts test/extension-session.test.ts
git commit -m "feat: route session action notifications"
```

### Task 2: Add shared final mutation guard

**Files:**
- Create: `src/shared/session-actions.ts`
- Create: `test/session-actions.test.ts`
- Modify: `src/shared/events.ts` only if Task 1 did not define the shared notification type there.

**Interfaces:**
- Produce:

```ts
export interface SessionActionStarted<T> {
	started: true;
	value: T;
	currentAfterAction: boolean;
}

export interface SessionActionSkipped {
	started: false;
	currentAfterAction: false;
}

export type SessionActionResult<T> =
	| SessionActionStarted<T>
	| SessionActionSkipped;

export function runSessionAction<T>(
	isCurrent: () => boolean,
	action: () => Promise<T> | T,
	notifySkipped: () => Promise<void> | void,
): Promise<SessionActionResult<T>>;
```

- [ ] **Step 1: Write failing tests**

Test that a stale action does not invoke its callback and awaits `notifySkipped`. Test that a current action invokes the callback exactly once and returns `started: true`. Test that a session transition during an awaited action returns `currentAfterAction: false` without converting a successful action into `started: false`. Test that thrown action errors propagate unchanged.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npx vitest run test/session-actions.test.ts`
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Check `isCurrent()` immediately before calling `action()`. On false, await `notifySkipped()` and return `started: false`. Invoke `action()` directly after that check, await its result, then evaluate `isCurrent()` once after completion. Never call `notifySkipped` for an action that already started; callers choose a result-specific message for that case.

- [ ] **Step 4: Run focused test**

Run: `npx vitest run test/session-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/session-actions.ts test/session-actions.test.ts
git commit -m "feat: guard session action dispatch"
```

### Task 3: Simplify Todoist completion and refresh guards

**Files:**
- Modify: `src/todoist/internal-state.ts`
- Modify: `src/todoist/client.ts`
- Modify: `src/todoist/completion.ts`
- Modify: `src/todoist/commands.ts`
- Modify: `src/todoist/event-consumers.ts` where only session-current checks surround read-only worker inspection.
- Modify: `test/todoist/client.test.ts`
- Modify: `test/todoist/commands.test.ts`
- Modify: `test/integration/todoist-merge-consumer.test.ts`
- Modify: `test/todoist/module.test.ts`

**Interfaces:**
- Consume `runSessionAction` and `publishSessionNotification`.
- `TodoistClientLike.completeTask(ref: string): Promise<void>` no longer accepts an `isCurrent` callback.
- Preserve `SelectedTaskContext` task/session snapshot fields needed to reject stale state writes.

- [ ] **Step 1: Write failing tests**

Update client tests to expect `completeTask(ref)` without a callback. Add completion tests proving: stale session skips Todoist dispatch and publishes warning; a command that starts before session transition is still treated as started, does not publish a false “not dispatched” warning, and does not persist old state; current successful completion still clears state and notifies success. Update refresh tests so read-only inspection/worker completion is not discarded solely because session identity changed, while final state update remains protected by task/session snapshot checks.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run test/todoist/client.test.ts test/todoist/commands.test.ts test/integration/todoist-merge-consumer.test.ts test/todoist/module.test.ts`
Expected: FAIL against current callback signatures and behavior.

- [ ] **Step 3: Remove per-request client cancellation checks**

Remove `IsCurrentOperation` from `TodoistClientLike`, `TodoistClient.run`, and all client method signatures. Keep command error parsing unchanged. `completeTask` must dispatch its Todoist command normally once called.

- [ ] **Step 4: Guard Todoist completion dispatch**

Capture the existing completion identity predicate for the original session/task/PR/revision. Pass it to `runSessionAction`; on skipped dispatch publish a warning such as `Todoist task completion skipped because session changed` and return failed. If the action starts but `currentAfterAction` is false, publish an informational/warning result message, skip old shared-state persistence, and return the external action’s success result rather than manufacturing cancellation.

- [ ] **Step 5: Simplify read-only worker flow**

Remove redundant session checks before/after read-only project inspection and worker execution. Retain checks at the point where claim/refresh results are accepted into shared state, including task identity and operation ownership checks. Keep worker protocol `sessionId` only where needed to reject mismatched worker payloads; it is not persisted extension state.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run test/todoist/client.test.ts test/todoist/commands.test.ts test/integration/todoist-merge-consumer.test.ts test/todoist/module.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/todoist test/todoist test/integration/todoist-merge-consumer.test.ts
git commit -m "refactor: guard Todoist mutations at dispatch"
```

### Task 4: Guard worktree destructive commands individually

**Files:**
- Modify: `src/worktree/internal-state.ts`
- Modify: `src/worktree/git.ts`
- Modify: `src/worktree/event-consumers.ts`
- Modify: `test/worktree/module.test.ts`

**Interfaces:**
- Consume `runSessionAction`.
- Extend cleanup options with an action runner or notification callback that allows `git.ts` to publish the shared notification without importing root event wiring.
- Preserve `ExitActionResult` return values and existing partial-cleanup notifications.

- [ ] **Step 1: Write failing tests**

Add tests proving stale worktree removal does not invoke `git worktree remove` and publishes warning. Add a test where removal starts, session changes, and branch deletion is skipped with a notification; preserve successful removal and branch deletion in the current session. Change read-only status/inspection tests so a session transition does not discard the inspection result unless it would write stale shared state.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npx vitest run test/worktree/module.test.ts`
Expected: FAIL because cleanup still uses direct repeated identity checks and emits no session notification.

- [ ] **Step 3: Integrate action guard at each mutation**

Pass a small action-runner dependency from `Worktree` into `cleanupWorktree`. Wrap `git worktree remove` and `git branch -D` separately. On a skipped command, publish caller-supplied warning and return `FAILED`; after a started command, use `currentAfterAction` only to prevent subsequent stale mutations and stale state publication. Keep `changeDirectory` guarded before it changes process cwd. Do not pass old `ExtensionContext` to the notification event.

- [ ] **Step 4: Simplify non-destructive checks**

Remove session-ID checks surrounding read-only Git inspection where no state write follows. Retain request sequence checks to reject older refresh results and retain baseline identity checks before cleanup state is committed.

- [ ] **Step 5: Run focused test**

Run: `npx vitest run test/worktree/module.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worktree test/worktree/module.test.ts
git commit -m "refactor: guard worktree mutations at dispatch"
```

### Task 5: Document rule and run full verification

**Files:**
- Modify: `AGENTS.md`
- Modify: affected tests only if integration failures expose contract changes.

- [ ] **Step 1: Add future-agent guidance**

Append:

```md
## Session-bound background work

Do not add repeated session-identity checks around ordinary read-only background work. For irreversible external mutations, use shared session-action guard at final dispatch and publish one session notification when dispatch is skipped or state synchronization is affected. Never pass originating `ExtensionContext` to notify a later session.
```

- [ ] **Step 2: Run repository verification**

Run: `npm test`
Expected: all Vitest tests pass.

Run: `npm run lint`
Expected: Biome and strict repository lint pass.

Run: `npm run typecheck`
Expected: TypeScript exits successfully with no diagnostics.

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 3: Review diff and commit guidance**

Run: `git status --short` and `git diff HEAD~4..HEAD --stat` (adjust commit range if task commits differ). Confirm no persisted `activeSessionId` field was introduced, no originating context enters notification payloads, and no session-transition blocking was added.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: guide session-bound background work"
```
