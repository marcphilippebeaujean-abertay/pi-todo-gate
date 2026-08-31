# Herdr Claim Gate Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version custom Herdr tab-claim enforcement inside `pi-todo-gate`, run its setup in a separate background Pi worker, reuse task-gate Git helpers, and keep worker instructions/results out of the main agent conversation.

**Architecture:** Extract the custom Herdr gate into `src/herdr-claim-gate.ts` and a cancellable `pi --mode json -p --no-session --no-extensions` worker adapter. Compose the gate from the existing `extensions/pi-todo-gate.ts` entry while keeping Herdr activation global and Todoist activation project-scoped. Share pure Git path/branch parsing helpers with `src/shared/project.ts`; surface worker lifecycle through user UI notifications only.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, Pi ExtensionAPI, Vitest, existing `src/shared/command.ts` command abstractions, and the installed `pi` CLI.

**Spec:** `docs/superpowers/specs/2026-08-30-herdr-claim-gate-integration-design.md`

## Global Constraints

- Herdr gate activates for non-subagent sessions only when `HERDR_ENV=1`.
- `PI_SUBAGENT_CHILD=1` skips Herdr worker startup, gate blocking, and Herdr instructions.
- Herdr setup runs in separate background Pi process/session; main session gets no Herdr prompt/context/message/result.
- Worker completion/failure reaches user through `ctx.ui.notify()` only; internal gate callback is allowed.
- Todoist/PR behavior remains nearest-configured-project scoped and unchanged outside integration wiring.
- Existing `herdr-agent-state.ts` remains Herdr-managed and is not copied or modified.
- Legacy `~/.pi/agent/extensions/herdr-claim-gate.ts` cleanup remains manual; installer stays non-destructive.
- External commands use argument arrays and `shell: false`.
- Production code follows TDD: each behavior test is written and observed failing before implementation.
- No project instruction files are modified.
- After verification, push `integrate-herdr-gate` and create PR against `master`; inspect PR comments before merge.

---

### Task 1: Extract shared Git path and branch helpers

**Files:**
- Modify: `src/shared/project.ts`
- Modify: `test/git.test.ts`

**Interfaces:**

```ts
export function resolveGitPath(cwd: string, output: string): string | null;
export function parseBranchName(output: string): string | null;
export function isLinkedWorktreePaths(
  cwd: string,
  gitDirOutput: string,
  commonDirOutput: string,
): boolean;
```

- [ ] **Step 1: Write failing helper tests**

Add tests to `test/git.test.ts`:

```ts
it("normalizes git path output relative to cwd", () => {
  expect(resolveGitPath("/repo/worktree", ".git/worktrees/feature\n")).toBe(
    "/repo/worktree/.git/worktrees/feature",
  );
  expect(resolveGitPath("/repo", "\n")).toBeNull();
});

it("parses a non-empty branch name", () => {
  expect(parseBranchName("feature/dialog-editor\n")).toBe("feature/dialog-editor");
  expect(parseBranchName("\n")).toBeNull();
});

it("detects linked worktree from git and common directory paths", () => {
  expect(
    isLinkedWorktreePaths(
      "/repo/worktree",
      ".git/worktrees/feature",
      "/repo/.git",
    ),
  ).toBe(true);
  expect(isLinkedWorktreePaths("/repo", "/repo/.git", "/repo/.git")).toBe(false);
});
```

Import the three functions before running the test.

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
npm test -- --run test/git.test.ts
```

Expected: FAIL with missing exports or undefined helper behavior. Existing Git tests must still load.

- [ ] **Step 3: Implement minimal pure helpers**

In `src/shared/project.ts`, normalize non-empty output with `resolve(cwd, output.trim())`; return `null` for empty output. Implement `parseBranchName` with trim and null for empty output. Implement `isLinkedWorktreePaths` by resolving both outputs through `resolveGitPath` and comparing resolved paths; return `false` when either path is unavailable.

Refactor `inspectWorktree` to use `resolveGitPath(cwd, rootResult.stdout)` and `parseBranchName(branchResult.stdout)`. Keep existing worktree-list comparison and return shape unchanged.

- [ ] **Step 4: Run helper and regression tests**

Run:

```bash
npm test -- --run test/git.test.ts
npm run typecheck
```

Expected: all Git tests and typecheck pass.

- [ ] **Step 5: Commit shared helper change**

```bash
git add src/shared/project.ts test/git.test.ts
git commit -m "refactor: share git path helpers with herdr gate"
```

### Task 2: Build cancellable background Herdr worker

**Files:**
- Create: `src/herdr-claim-worker.ts`
- Create: `test/herdr-claim-worker.test.ts`

**Interfaces:**

```ts
export interface ClaimWorkerRequest {
  prompt: string;
  instructions: string;
  onClaimComplete: () => void;
  onFailure: (message: string) => void;
}

export interface ClaimWorkerHandle {
  cancel(): void;
}

export interface ClaimWorkerOptions {
  command?: string;
  cwd?: string;
  spawnWorker?: WorkerSpawner;
}

export type WorkerSpawner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: false },
) => WorkerProcess;

export interface WorkerProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export function startClaimWorker(
  request: ClaimWorkerRequest,
  options?: ClaimWorkerOptions,
): ClaimWorkerHandle;
```

- [ ] **Step 1: Write failing worker tests**

Use a fake process with readable stdout/stderr streams and event listeners. Cover:

```ts
it("starts a separate ephemeral Pi process with isolated worker prompt", () => {
  const request = { prompt: "Fix dialog", instructions: "Claim tab", onClaimComplete, onFailure };
  const handle = startClaimWorker(request, { spawnWorker: fakeSpawn });

  expect(spawned.command).toBe("pi");
  expect(spawned.args).toEqual([
    "--mode", "json", "-p", "--no-session", "--no-extensions",
    expect.stringContaining("Fix dialog"),
  ]);
  expect(spawned.args.at(-1)).toContain("Claim tab");
  expect(spawned.options.shell).toBe(false);
  expect(spawned.options.env.PI_SUBAGENT_CHILD).toBe("1");
  expect(spawned.options.env.HERDR_ENV).toBe(process.env.HERDR_ENV);
  expect(handle.cancel).toBeTypeOf("function");
});

it("calls completion without forwarding worker output", () => {
  const output = ["worker private result", "claim complete"].join("\n");
  startClaimWorker(request, { spawnWorker: fakeSpawn });
  fakeProcess.stdout.emit("data", Buffer.from(output));
  fakeProcess.emit("close", 0);
  expect(onClaimComplete).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();
});

it("reports nonzero exit and cancellation without throwing", () => {
  const handle = startClaimWorker(request, { spawnWorker: fakeSpawn });
  fakeProcess.emit("close", 1);
  expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("worker"));
  handle.cancel();
  expect(fakeProcess.kill).toHaveBeenCalledWith("SIGTERM");
});
```

The test must assert no worker stdout/stderr is emitted through `pi.events`, `sendMessage`, or any main-session callback other than `onClaimComplete`/`onFailure`.

- [ ] **Step 2: Run worker tests and verify RED**

```bash
npm test -- --run test/herdr-claim-worker.test.ts
```

Expected: FAIL because `src/herdr-claim-worker.ts` is absent.

- [ ] **Step 3: Implement worker spawn**

Compose one child prompt from current user prompt and Herdr instructions. Spawn default command `pi` with exactly:

```text
pi --mode json -p --no-session --no-extensions <worker-prompt>
```

Use `spawn(command, args, { cwd, env: { ...process.env, PI_SUBAGENT_CHILD: "1" }, shell: false })`. Preserve `HERDR_ENV`, Herdr workspace/tab/pane variables, and the configured project cwd. Capture stdout/stderr only for bounded failure diagnostics; never forward output to the parent agent. Treat close code `0` as completion and any nonzero/error event as failure. Make completion/failure idempotent. `cancel()` sends `SIGTERM` once and suppresses later callbacks.

- [ ] **Step 4: Run worker tests and typecheck**

```bash
npm test -- --run test/herdr-claim-worker.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit worker adapter**

```bash
git add src/herdr-claim-worker.ts test/herdr-claim-worker.test.ts
git commit -m "feat: run herdr claim in background worker"
```

### Task 3: Version and adapt Herdr claim gate

**Files:**
- Create: `src/herdr-claim-gate.ts`
- Create: `test/herdr-claim-gate.test.ts`
- Source reference: `~/.pi/agent/extensions/herdr-claim-gate.ts`
- Test reference: `~/.pi/agent/extensions/tests/herdr-claim-gate.test.ts`

**Interfaces:**

```ts
export interface ClaimGateOptions {
  commandRunner?: CommandRunner;
  cwd?: string;
  startBackgroundWorker?: StartBackgroundWorker;
}

export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
  request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export function installHerdrClaimGate(
  pi: ExtensionAPI,
  options?: ClaimGateOptions,
): void;
```

- [ ] **Step 1: Convert external tests to Vitest and add new RED cases**

Copy behavior cases from the external test into `test/herdr-claim-gate.test.ts`, replacing `node:test`/`assert` with Vitest `describe`, `it`, `expect`, and injectable fake runners. Preserve cases for linked-worktree rename, descriptive tabs, non-worktrees, command failures, allow-listed inspection, subagent exemption, blocking, marker resume, and strict command rejection.

Add these prompt-isolation cases:

```ts
it("starts worker with current prompt but returns no main-session message", async () => {
  const worker = fakeWorker();
  const pi = createFakePi();
  installHerdrClaimGate(pi, { startBackgroundWorker: worker.start });
  await emitSessionStart(pi, insideHerdrContext());
  const result = await emitBeforeAgentStart(pi, { prompt: "Fix dialog editor" });

  expect(result).toBeUndefined();
  expect(worker.request.prompt).toBe("Fix dialog editor");
  expect(worker.request.instructions).toContain("# STEP 0 — Setup Herdr");
});

it("notifies user on worker completion without informing main agent", async () => {
  const worker = fakeWorker();
  const pi = createFakePi();
  installHerdrClaimGate(pi, { startBackgroundWorker: worker.start });
  await emitSessionStart(pi, insideHerdrContext());
  await emitBeforeAgentStart(pi, { prompt: "Fix dialog editor" });
  worker.complete();

  expect(pi.notifications).toEqual([
    expect.objectContaining({ message: expect.stringContaining("Herdr") }),
  ]);
  expect(pi.sentMessages).toHaveLength(0);
  expect(pi.contextMessages).toHaveLength(0);
});

it("does not start worker or inject instructions for dispatched child", async () => {
  const worker = fakeWorker();
  const pi = createFakePi();
  installHerdrClaimGate(pi, { startBackgroundWorker: worker.start });
  await emitSessionStart(pi, insideHerdrContext({ subagent: true }));
  await emitBeforeAgentStart(pi, { prompt: "child work" });

  expect(worker.started).toBe(false);
  expect(pi.contextMessages).toHaveLength(0);
});
```

Assert `before_agent_start` always returns `undefined` for Herdr. Remove old assertions requiring a `herdr-instructions` custom message in the main session. Keep instruction text test by asserting it is passed to worker request.

- [ ] **Step 2: Run gate tests and verify RED**

```bash
npm test -- --run test/herdr-claim-gate.test.ts
```

Expected: FAIL because versioned module and worker integration are absent.

- [ ] **Step 3: Implement isolated gate module**

Copy policy logic from external source into `src/herdr-claim-gate.ts`. Preserve constants and strict allow-list. Replace duplicated linked-worktree check with `isLinkedWorktreePaths(cwd, gitDirOutput, commonDirOutput)` and branch parsing with `parseBranchName`.

At `session_start`, arm only for `HERDR_ENV=1` and no `PI_SUBAGENT_CHILD=1`; recognize existing `herdr-claim-gate` marker. Keep auto-rename behavior and append marker after successful claim. Use `ctx.ui.notify()` for warnings and completion only.

At `before_agent_start`, when gate is active and no worker is running, call `startBackgroundWorker({ prompt: event.prompt ?? "", instructions: HERDR_INSTRUCTIONS, onClaimComplete, onFailure })`. Return `undefined`; never return `{ message }`, append `herdr-instructions` to the main context, call `sendMessage`, or call `sendUserMessage`. `onClaimComplete` only lifts gate, persists internal marker, and notifies user. `onFailure` keeps gate active and notifies user with bounded diagnostic.

Keep `tool_call` blocking and `tool_result` descriptive-tab detection. On shutdown, cancel active worker and reset gate state. Do not register a `context` handler that injects, deduplicates, or removes Herdr instructions in the main session.

- [ ] **Step 4: Run gate tests and typecheck**

```bash
npm test -- --run test/herdr-claim-gate.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit versioned gate**

```bash
git add src/herdr-claim-gate.ts test/herdr-claim-gate.test.ts
git commit -m "feat: version herdr claim gate"
```

### Task 4: Compose gate with Todoist extension entry

**Files:**
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `test/extension.test.ts`

**Interfaces:**

```ts
import { installHerdrClaimGate } from "../src/herdr-claim-gate.ts";
```

- [ ] **Step 1: Add failing composition test**

Add a test that sets `HERDR_ENV=1`, starts the normal extension with an unmatched Todoist project, and verifies Herdr worker wiring is available while Todoist state tool remains absent. Add a second test with `HERDR_ENV` unset proving existing configured-project behavior still registers only `pi_todo_gate_state`.

Use injected worker/command dependencies and restore all environment variables in `finally` blocks.

- [ ] **Step 2: Run composition tests and verify RED**

```bash
npm test -- --run test/extension.test.ts
```

Expected: new composition assertion fails because existing entry does not install Herdr gate.

- [ ] **Step 3: Install Herdr gate from existing package entry**

Call `installHerdrClaimGate(pi, { startBackgroundWorker: (request) => startClaimWorker(request, { cwd: process.cwd() }) })` after the subagent guard and before PR/Todoist lifecycle handlers are registered in `extensions/pi-todo-gate.ts`. Keep Todoist dependency injection unchanged. Do not change `extensions/index.ts` export or package metadata unless tests show the installed entry bypasses composition.

Ensure the Herdr worker's child environment preserves current Herdr variables and sets `PI_SUBAGENT_CHILD=1`, so child extension loading cannot recursively arm another gate.

- [ ] **Step 4: Run composition and full existing tests**

```bash
npm test -- --run test/extension.test.ts
npm test
npm run typecheck
```

Expected: all tests pass; unmatched Todoist projects remain inert for Todoist behavior; Herdr behavior remains global inside Herdr.

- [ ] **Step 5: Commit composition**

```bash
git add extensions/pi-todo-gate.ts test/extension.test.ts
git commit -m "feat: compose herdr gate with todo gate"
```

### Task 5: Add migration documentation

**Files:**
- Create: `docs/herdr-claim-gate-migration.md`

- [ ] **Step 1: Write migration documentation**

Document this exact sequence:

1. Run package tests and install the versioned `pi-todo-gate` extension directory.
2. Confirm Herdr claim worker starts in a separate `pi --mode json -p --no-session --no-extensions` process.
3. Manually remove `~/.pi/agent/extensions/herdr-claim-gate.ts` and its external test file to avoid duplicate handlers.
4. Leave `~/.pi/agent/extensions/herdr-agent-state.ts` in place because Herdr owns and updates it.
5. Restart Pi and verify user notification appears after worker claim while main agent context contains no Herdr instructions/results.

State that installer does not remove either global file automatically.

- [ ] **Step 2: Commit migration note**

```bash
git add docs/herdr-claim-gate-migration.md
git commit -m "docs: document herdr gate migration"
```

### Task 6: Verify, review, push, and open PR

**Files:**
- Modify: tests only if verification exposes a concrete regression.

- [ ] **Step 1: Run required automated checks**

```bash
npm test
npm run typecheck
npm run lint
git diff --check
git status --short --branch
```

Expected: all tests pass, typecheck/lint pass, no whitespace errors, and only intended files are changed.

- [ ] **Step 2: Run focused prompt-isolation checks**

```bash
npm test -- --run test/herdr-claim-worker.test.ts test/herdr-claim-gate.test.ts test/extension.test.ts
```

Confirm tests prove:

- worker receives user prompt and Herdr instructions only in child request;
- worker stdout/stderr never becomes main agent context or message;
- only user notification reports worker completion/failure;
- main `before_agent_start` returns no Herdr message;
- dispatched children skip worker startup;
- Todoist gate remains project-scoped.

- [ ] **Step 3: Inspect final diff**

```bash
git diff origin/feature/pi-todo-gate-design...HEAD --stat
git diff origin/feature/pi-todo-gate-design...HEAD --check
git log --oneline --decorate -12
```

Review no changes to `herdr-agent-state.ts`, no copied global extension paths, no shell interpolation, and no main-session `sendMessage`/`sendUserMessage` calls.

- [ ] **Step 4: Push feature branch**

```bash
git push -u origin integrate-herdr-gate
```

Expected: branch publishes without touching `master`.

- [ ] **Step 5: Create GitHub PR**

```bash
gh pr create \
  --base master \
  --head integrate-herdr-gate \
  --title "feat: integrate versioned Herdr claim gate" \
  --body-file /tmp/pi-todo-gate-pr-body.md
```

Write `/tmp/pi-todo-gate-pr-body.md` with this content, replacing `<test-output>` with concise actual command outcomes:

```markdown
## Summary

- version custom Herdr claim gate in `pi-todo-gate`
- run Herdr setup in separate ephemeral background Pi worker
- keep worker instructions/results out of main agent context
- reuse shared Git path and branch helpers

## Migration

Remove legacy `~/.pi/agent/extensions/herdr-claim-gate.ts` manually after installing this package. Keep Herdr-managed `herdr-agent-state.ts` unchanged.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
```

Do not include Herdr secrets or worker output.

- [ ] **Step 6: Inspect PR comments before merge**

```bash
gh pr view integrate-herdr-gate --comments
```

Report PR URL, checks, and unresolved comments. Do not merge automatically.
