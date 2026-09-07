# Merge Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate `/merge` execution, discoverable `merge-protocol` skill guidance, isolated PR/GitHub code, and event-driven Todoist completion confirmation.

**Architecture:** Keep PR URL/GitHub CLI/merge parsing and verified merge detection under `src/pr/`. Keep command execution and repository inspection in shared/worktree infrastructure. The extension boundary registers `/merge` and connects PR events to Todoist; Todoist consumes mutable `prMerged` payloads and owns task completion confirmation.

**Tech Stack:** TypeScript, Pi Extension API, Agent Skills `SKILL.md`, dependency-cruiser, Vitest, Biome, strict custom lint.

**Spec:** `docs/superpowers/specs/2026-09-07-merge-protocol-design.md`

## Global Constraints

- `/merge` is the only direct extension command; it executes the protocol immediately.
- `/merge` targets only the active session's pinned PR and stops when none exists.
- Merge operation uses `gh pr merge <pinned-url> --merge`.
- Merge confirmation precedes every merge command.
- Todoist completion is a separate confirmation and never automatic.
- `taskMarkedAsCompleted` starts `false` and becomes `true` only after confirmed successful completion.
- Natural-language input is not pattern-matched by the extension; the agent decides when to load `merge-protocol`.
- Other feature modules do not import `src/pr/`; extension composition is the boundary caller.
- Preserve argument-array process execution, current `cwd`, operation-generation checks, and session isolation.
- Do not commit unrelated changes from the pre-existing worktree.

---

### Task 1: Finish PR/Git module isolation

**Files:**
- Create: `src/pr/merge-detection.ts`
- Create: `src/pr/merge-matching.ts`
- Create: `src/pr/shell-parser.ts`
- Modify: `src/pr/git.ts`
- Modify: `src/pr/module.ts`
- Modify: `src/shared/command.ts`
- Modify: `src/shared/project.ts`
- Delete after migration: `src/git.ts`, `src/git-pr.ts`, `src/git-merge.ts`, `src/git-worktree.ts`, `src/pr-detection.ts`, `src/shared/merge-detection.ts`, `src/shared/merge-matching.ts`, `src/shell-parser.ts`, `src/command-exec.ts`
- Modify: `src/extension-events.ts`, `src/extension-session.ts`, `src/extension-lifecycle.ts`, `src/extension-tool.ts`, `src/extension-types.ts`, `src/todoist/claiming-flow.ts`, `src/footer.ts`
- Test: `test/pr/detection.test.ts`, `test/pr/git.test.ts`, `test/pr/merge-detection.test.ts`, `test/shared/project.test.ts`, `test/todoist/client.test.ts`

**Interfaces:**
- `src/shared/command.ts` exports `CommandResult`, `Exec`, and `spawnExec`.
- `src/shared/project.ts` exports `ProjectInfo`, `inspectProject`, and `hasUncommittedChanges`.
- `src/pr/module.ts` exports PR-only functions: `githubPrUrl`, `githubPrUrls`, `firstGithubPrUrl`, `firstUnmergedGithubPrUrl`, `findOpenPr`, `findPrState`, `isGithubPrAvailable`, `mergeCommand`, `matchesPinnedPr`, and PR display functions.
- `src/pr/git.ts` imports command types only from `src/shared/command.ts`.

- [ ] **Step 1: Write migration assertions**

Add tests or architecture assertions that import PR behavior from `../../src/pr/...`, import generic command/project behavior from `../../src/shared/...`, and fail if obsolete root imports remain. Keep detection assertions for normalized GitHub PR URLs, ignored URL behavior, open PR parsing, merged-state validation, and strict merge matching.

```ts
expect(githubPrUrl("https://github.com/o/r/pull/42?tab=files")).toBe(
  "https://github.com/o/r/pull/42",
);
expect(mergeCommand("git merge --no-commit feature/auth")).not.toBeNull();
expect(await matchesPinnedPr(exec, "/repo", "git merge feature/auth", prUrl)).toBe(false);
```

- [ ] **Step 2: Run migration tests and architecture check**

Run: `npx vitest run test/pr/detection.test.ts test/pr/git.test.ts test/pr/merge-detection.test.ts test/shared/project.test.ts test/todoist/client.test.ts && npm run architecture`

Expected: tests initially expose any stale imports or missing exports; architecture reports no forbidden PR consumers after migration.

- [ ] **Step 3: Move implementation and update imports**

Keep PR-specific parsing in `src/pr/merge-detection.ts` and matching in `src/pr/merge-matching.ts`. Move shell parsing beside them. Keep `hasUncommittedChanges` in `src/shared/project.ts`, because it is repository status infrastructure rather than PR behavior. Update extension and Todoist claim code to import command/project functions from shared locations and PR functions only through the extension boundary.

Remove duplicate compatibility implementations instead of leaving re-export files. Ensure `src/pr/module.ts` re-exports `isGithubPrAvailable` and all detection/matching functions needed by extension composition.

- [ ] **Step 4: Tighten dependency-cruiser rules**

Add forbidden edges for `src/pr/` to Todoist, Herdr, footer internals, and other feature modules; forbid shared domain code and feature modules from importing `src/pr/`; allow only extension composition files to consume the PR facade. Keep test-domain restrictions symmetric.

- [ ] **Step 5: Run migration verification**

Run: `rg -n 'src/(git|pr-detection)|shared/merge|from "\./git|from "\.\./git' src extensions test --glob '*.ts'`

Expected: no obsolete import paths outside the intentional `src/pr/` internal files.

Run: `npm run architecture && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit migration**

```bash
git add src extensions test .dependency-cruiser.cjs
git commit -m "refactor: isolate PR Git infrastructure"
```

---

### Task 2: Add mutable merged-event contract

**Files:**
- Modify: `src/shared/events.ts`
- Modify: `src/constants.ts`
- Modify: `test/events.test.ts`
- Modify: `test/extensions/pi-todo-gate.test.ts`

**Interfaces:**
- `SharedEventPayloads["prMerged"]` becomes `{ prUrl: string; taskMarkedAsCompleted: boolean }`.
- `EventRequest.payload` becomes mutable for event consumers that update event-owned result flags.
- PR producers emit `{ prUrl, taskMarkedAsCompleted: false }`.

- [ ] **Step 1: Add failing event tests**

Test that a `prMerged` listener sees `taskMarkedAsCompleted === false`, may set it to `true`, and that later listeners see the updated value. Preserve action deduplication and collect-before-present ordering.

```ts
await events.emit("prMerged", { prUrl: PR_URL, taskMarkedAsCompleted: false });
expect(observed).toEqual({ prUrl: PR_URL, taskMarkedAsCompleted: true });
```

- [ ] **Step 2: Run event tests**

Run: `npx vitest run test/events.test.ts`

Expected: FAIL until payload mutability and the new field are implemented.

- [ ] **Step 3: Implement contract**

Update the shared payload type and remove `readonly` only from `EventRequest.payload`; retain readonly action views and listener registration types. Update every event emission to provide the boolean. Keep event listener error isolation unchanged.

- [ ] **Step 4: Run event and type checks**

Run: `npx vitest run test/events.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit event contract**

```bash
git add src/shared/events.ts src/constants.ts test/events.test.ts test/extensions/pi-todo-gate.test.ts
git commit -m "feat: expose merged task completion status"
```

---

### Task 3: Replace Todoist exit action with merge-event consumer

**Files:**
- Create: `src/todoist/merge-consumer.ts`
- Modify: `src/todoist/module.ts`
- Modify: `src/extension-runtime.ts`
- Delete: `src/exit-protocol/todoist-action.ts`
- Modify: `src/exit-protocol/types.ts`
- Modify: `src/extension-events.ts`
- Modify: `src/task-completion.ts`
- Modify: `test/exit-protocol.test.ts`
- Create/modify: `test/todoist/merge-consumer.test.ts`

**Interfaces:**
- `registerTodoistMergeConsumer(runtime: ExtensionRuntime): void` registers a collect-phase `prMerged` listener.
- Consumer prompts through `session.context.ui.confirm(title, message)` and sets `request.payload.taskMarkedAsCompleted = true` only after successful `completeTask`.
- Existing `completeMergedTask(...)` remains the serialized, generation-safe completion operation or is factored into the consumer without changing its stale-operation guarantees.

- [ ] **Step 1: Write failing consumer tests**

Cover assigned task, no task, confirmation decline, successful completion, CLI failure, stale session, and no-UI behavior. Use a mutable event request fixture and assert exact command/prompt behavior.

```ts
await events.emit("prMerged", {
  prUrl: PR_URL,
  taskMarkedAsCompleted: false,
});
expect(confirm).toHaveBeenCalledWith(
  'Mark Todoist task "Implement feature" complete?',
  expect.any(String),
);
expect(request.payload.taskMarkedAsCompleted).toBe(false);
```

For success, assert `completeTask` runs once and the flag becomes `true`. For decline/failure, assert the flag stays `false` and task assignment remains in state.

- [ ] **Step 2: Run consumer tests**

Run: `npx vitest run test/todoist/merge-consumer.test.ts test/exit-protocol.test.ts`

Expected: FAIL because current Todoist completion is registered as an exit action.

- [ ] **Step 3: Implement collect-phase consumer**

Register consumer during runtime construction. Snapshot session state, task reference, task name, work revision, and current session identity before awaiting UI or Todoist CLI. Skip when no active task or `hasUI === false`. Ask completion only after `prMerged` is emitted, then call `completeMergedTask` using current-operation checks. Set the event flag after the operation reports success; do not set it for deferred, failed, declined, or stale results.

Remove `registerTodoistExitAction(runtime)` and its merge-completion action registration. Keep worktree actions and exit protocol behavior independent.

- [ ] **Step 4: Run Todoist and lifecycle tests**

Run: `npx vitest run test/todoist test/exit-protocol.test.ts test/extensions/pi-todo-gate.test.ts`

Expected: PASS; no Todoist completion prompt appears from session quit or old exit picker.

- [ ] **Step 5: Commit Todoist consumer**

```bash
git add src/todoist src/exit-protocol src/extension-runtime.ts src/extension-events.ts src/task-completion.ts test/todoist test/exit-protocol.test.ts test/extensions/pi-todo-gate.test.ts
git commit -m "feat: confirm Todoist completion from merge events"
```

---

### Task 4: Implement immediate `/merge` command

**Files:**
- Modify: `src/merge-protocol.ts`
- Create: `src/pr/protocol.ts`
- Modify: `src/pr/module.ts`
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `src/extension-runtime.ts`, `src/extension-types.ts`, and `src/constants.ts`
- Create/modify: `test/merge-protocol.test.ts`

**Interfaces:**
- `registerMergeProtocol(pi: ExtensionAPI, runtime: ExtensionRuntime): void` registers exactly `/merge`.
- `runMergeProtocol(runtime: ExtensionRuntime, context: ExtensionCommandContext): Promise<void>` performs direct confirmation, merge, and event emission.
- `runMergeProtocol` uses `runtime.dependencies.exec ?? spawnExec`, active `session.context.cwd`, and `runtime.events.emit("prMerged", { prUrl, taskMarkedAsCompleted: false })`.

- [ ] **Step 1: Write failing command tests**

Test command registration, immediate UI confirmation, declined confirmation, missing pinned PR, inactive project, no UI, successful `gh pr merge`, failed command, rejected executor, event payload, and current cwd.

```ts
await commands.get("merge")?.handler("", context);
expect(confirm).toHaveBeenCalledWith(
  `Merge PR ${PR_URL}?`,
  "Confirm merge of pinned pull request.",
);
expect(exec).toHaveBeenCalledWith(
  "gh",
  ["pr", "merge", PR_URL, "--merge"],
  { cwd: "/repo" },
);
expect(emitted).toEqual({ prUrl: PR_URL, taskMarkedAsCompleted: false });
```

Assert `/merge` does not call `sendUserMessage`, does not register an input handler, and does not register `/merge-protocol` as an extension command.

- [ ] **Step 2: Run command tests**

Run: `npx vitest run test/merge-protocol.test.ts`

Expected: FAIL because current implementation transforms natural input and dispatches a skill message instead of executing protocol directly.

- [ ] **Step 3: Implement direct command path**

Replace input interception and `sendUserMessage` command behavior. Register `/merge` once at extension startup. Handler checks active session, `hasUI`, and non-empty pinned `session.state.prUrl`; notify and return otherwise. Ask explicit confirmation before invoking `gh`. Treat non-zero result or executor rejection as failure and emit no event. On success notify and await `runtime.events.emit` so Todoist confirmation completes deterministically before command returns.

Use session operation serialization and an operation generation captured before awaiting confirmation. After confirmation and after CLI completion, verify the session is still active/current before mutating or emitting.

- [ ] **Step 4: Run command and integration tests**

Run: `npx vitest run test/merge-protocol.test.ts test/extensions/pi-todo-gate.test.ts test/todoist/merge-consumer.test.ts`

Expected: PASS. `/merge` confirms merge first, executes one command, emits one event, then Todoist asks separate completion confirmation when task exists.

- [ ] **Step 5: Commit direct command**

```bash
git add src extensions test/merge-protocol.test.ts
git commit -m "feat: add immediate merge command"
```

---

### Task 5: Add discoverable merge-protocol skill

**Files:**
- Create: `skills/merge-protocol/SKILL.md`
- Modify: `package.json`
- Modify: `test/merge-protocol.test.ts`

**Interfaces:**
- Skill frontmatter has `name: merge-protocol` and a non-empty description.
- Package manifest does not declare `pi.skills`; extension `resources_discover` supplies the skill path only when extension loads.
- Skill instructs agent to use pinned PR only, ask explicit confirmation, run `gh pr merge <url> --merge`, stop on failure, and let the extension event consumer own Todoist completion confirmation.

- [ ] **Step 1: Write failing skill-resource tests**

Read the skill file in the test and assert frontmatter, no natural-input extension matcher, pinned-PR requirement, merge confirmation, exact merge command, and no direct Todoist completion instruction. Assert package manifest omits static `pi.skills` exposure.

```ts
expect(skill).toContain("name: merge-protocol");
expect(skill).toContain("gh pr merge <url> --merge");
expect(skill).toContain("Do not complete Todoist directly");
```

- [ ] **Step 2: Run skill tests**

Run: `npx vitest run test/merge-protocol.test.ts`

Expected: FAIL until the final skill and manifest are present.

- [ ] **Step 3: Write skill instructions**

Use valid Agent Skills frontmatter. State that the skill is for standalone merge intent when `/merge` was not used. Tell the agent to inspect session state, refuse ambiguous/unpinned targets, ask for explicit confirmation, run only the pinned PR merge command, report failure, and avoid a duplicate Todoist prompt because the extension consumes `prMerged`.

- [ ] **Step 4: Run skill and package checks**

Run: `npm run typecheck && npm run architecture && npx vitest run test/merge-protocol.test.ts`

Expected: PASS; extension dynamically contributes the skill without adding static package discovery or an input matcher.

- [ ] **Step 5: Commit skill**

```bash
git add skills package.json package-lock.json test/merge-protocol.test.ts
git commit -m "feat: add merge protocol skill"
```

---

### Task 6: Preserve PR display and lifecycle integration

**Files:**
- Modify: `src/footer.ts`
- Modify: `src/footer/module.ts` if state adapter wiring is needed
- Modify: `src/pr/footer.ts` only for PR display helpers not crossing module boundary
- Modify: `src/extension-events.ts`
- Modify: `src/worktree/module.ts`
- Modify: `test/pr/footer.test.ts`, `test/footer.test.ts`, `test/worktree.test.ts`, `test/extensions/pi-todo-gate.test.ts`

**Interfaces:**
- Footer renders normalized PR state without importing `src/pr/` from footer internals.
- Agent-initiated `gh pr merge` and `git merge` tool results still produce one verified `prMerged` event only when they match the pinned PR and complete successfully.
- Worktree cleanup remains an independent merged-event consumer.

- [ ] **Step 1: Add regression tests**

Assert PR footer labels remain unchanged, automatic merge detection still rejects non-completing options and unrelated targets, worktree cleanup still receives merged events, and direct command flow does not cause duplicate Todoist completion prompts.

- [ ] **Step 2: Run regression tests**

Run: `npx vitest run test/pr test/footer.test.ts test/worktree.test.ts test/extensions/pi-todo-gate.test.ts`

Expected: FAIL with stale-import or duplicate-action assertions until boundary adapters are updated.

- [ ] **Step 3: Implement boundary adapters**

Move any PR formatting needed by footer into footer-owned adapter code. Keep PR normalization internal to the PR facade and pass normalized URLs through runtime/footer state. Ensure extension event code uses `pr/module.ts` and shared command/project APIs without importing deleted files.

Keep merge fallback detection event-only: it must not complete Todoist directly and must emit the false completion flag.

- [ ] **Step 4: Run full local verification**

Run: `npm test && npm run typecheck && npm run lint && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 5: Commit lifecycle integration**

```bash
git add src test
 git commit -m "refactor: complete merge event integration"
```

---

### Task 7: Final review, push, and pull request

**Files:**
- Modify only files required by review findings.
- No new behavior outside the approved spec.

- [ ] **Step 1: Inspect complete diff and branch state**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Expected: branch is `merge-protocol`, latest `origin/main` is its base, no accidental swap files or unrelated edits exist, and diff has no whitespace errors.

- [ ] **Step 2: Run required verification**

Run: `npm test && npm run typecheck && npm run lint && git diff --check`

Expected: PASS for every command.

- [ ] **Step 3: Review behavior against acceptance criteria**

Confirm `/merge` directly prompts and executes only pinned PR; natural-language extension input is untouched; skill is discoverable; merged events start with false flag; Todoist asks only for assigned tasks; only confirmed successful completion flips flag; no duplicate exit prompt remains; PR/Git code is isolated.

- [ ] **Step 4: Push feature branch**

```bash
git push -u origin merge-protocol
```

Expected: remote branch `origin/merge-protocol` updated successfully; never push to `main` or `master`.

- [ ] **Step 5: Create GitHub PR**

```bash
pr_body=$(mktemp)
printf '%s\n' \
  '## Summary' \
  '- Add immediate /merge command and merge-protocol skill.' \
  '- Isolate PR/GitHub code under src/pr/.' \
  '- Confirm Todoist completion from prMerged events.' \
  '' \
  '## Verification' \
  '- npm test' \
  '- npm run typecheck' \
  '- npm run lint' \
  '- git diff --check' > "$pr_body"
gh pr create --base master --head merge-protocol --title "feat: add merge protocol" --body-file "$pr_body"
rm "$pr_body"
```

Verify PR URL and inspect comments before any merge action.
