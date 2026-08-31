# Herdr Claim Gate Integration Design

## Status

Design sections approved by user; written-spec review pending.

## Goal

Version custom Herdr tab-claim enforcement inside `pi-todo-gate`, reuse existing Git helpers, and keep Herdr-managed agent-state reporting outside package ownership.

## Scope Decisions

- Integrate only custom `herdr-claim-gate` code and its tests.
- Do not copy or modify `~/.pi/agent/extensions/herdr-agent-state.ts`; Herdr manages that file and overwrites local changes.
- Preserve global Herdr activation for every non-subagent session with `HERDR_ENV=1`.
- Preserve project-scoped activation for Todoist/PR behavior: unmatched projects remain inert for task-gate behavior.
- Compose both behaviors through one versioned package entry.
- Existing legacy `~/.pi/agent/extensions/herdr-claim-gate.ts` is removed manually after installation; installer does not delete it.
- Herdr setup runs in a separate background worker session, not in the main task-gate session.
- Herdr setup instructions are visible only inside that worker session. They must never be inserted into the main prompt conversation, main session history, or main session context.
- If implementation work is delegated, its worker uses a separate background session. Herdr worker completion/status is surfaced as a user-facing notification only; it is never added to the parent agent's context, messages, history, or prompt.

## Current Context

Custom Herdr code currently lives outside the repository at:

- `~/.pi/agent/extensions/herdr-claim-gate.ts`
- `~/.pi/agent/extensions/tests/herdr-claim-gate.test.ts`

Task-gate Git helpers currently live in `src/shared/project.ts` and `src/pr/git.ts`, including worktree inspection, branch extraction, and safe merge-command parsing. The custom Herdr gate independently checks linked worktrees and branch names with synchronous command execution. These overlapping path/branch decisions must share pure helpers.

## Architecture

### Package composition

Create `src/herdr-claim-gate.ts` with a named installation function:

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

export interface ClaimWorkerRequest {
  prompt: string;
  instructions: string;
  onClaimComplete: () => void;
  onFailure: (message: string) => void;
}

export interface ClaimWorkerHandle {
  cancel(): void;
}

export function installHerdrClaimGate(
  pi: ExtensionAPI,
  options?: ClaimGateOptions,
): void;
```

`extensions/pi-todo-gate.ts` invokes `installHerdrClaimGate(pi)` when its factory is created, then registers existing Todoist-gate behavior. This keeps policy code isolated while producing one installed extension package. `extensions/index.ts` continues to re-export the composed entry.

The gate starts the claim worker as a separate background Pi process/session using the host's supported worker mechanism with `--no-extensions`, so the child cannot load task-gate or Herdr extensions recursively. The worker prompt contains the current user prompt plus `HERDR_INSTRUCTIONS`; those bytes exist only in the worker session. The gate may receive an internal completion callback to update its own blocked/unblocked state, but the main session agent receives no worker status or result. User-facing status uses a notification only. Worker startup, completion, and failure are injectable so tests do not launch a real child process.

### Activation boundaries

The Herdr gate checks environment state at `session_start`:

- `HERDR_ENV=1` enables Herdr detection.
- `PI_SUBAGENT_CHILD=1` disables the gate and all Herdr instructions.
- Outside Herdr, no Herdr command runs and no Herdr instruction is injected.
- A persisted `herdr-claim-gate` custom entry marks resumed sessions claimed, so the gate remains open.
- In Herdr, the main session starts or attaches to a separate claim-worker session. The worker owns setup instructions and Herdr CLI work; the main session remains prompt-clean. Worker completion is user-notification-only, apart from internal gate-state handling.

The Todoist gate still resolves the nearest configured coding-project ancestor independently. Herdr activation does not depend on Todoist configuration.

### Shared helpers

Extend `src/shared/project.ts` with pure functions used by both task-gate and Herdr code:

```ts
export function resolveGitPath(cwd: string, output: string): string | null;
export function parseBranchName(output: string): string | null;
export function isLinkedWorktreePaths(
  cwd: string,
  gitDirOutput: string,
  commonDirOutput: string,
): boolean;
```

The existing async `inspectProject` uses these helpers for root and branch normalization. Herdr's synchronous runner uses the same path comparison and branch parsing. No shared helper invokes commands or embeds Herdr policy.

## Herdr Behavior

Preserve existing custom behavior:

1. At session start, reset in-memory gate state.
2. For non-subagent Herdr sessions without a claim marker, arm gate and start a separate background claim-worker session. Do not inject setup instructions into the main session.
3. The claim worker receives setup instructions in its own session and performs the tab claim. For linked worktrees with numeric default tabs and usable branch names, it may rename the tab automatically, append claim marker, and update gate state internally. Completion may notify the user, but must not inform the main session agent.
4. While gate is active, block every non-`bash` tool.
5. For bash, allow only literal env probes and listed Herdr inspection/claim commands. Reject shell chaining, command substitution, and backticks.
6. A successful tab rename or `pane move --new-tab` persists marker and lifts gate.
7. A successful `tab get` whose returned label is non-empty and non-numeric persists marker and lifts gate.
8. Append marker failures do not crash sessions; in-memory gate still lifts after successful claim.
9. Command failures leave gate active and produce a warning when UI notification is available.
10. The main session never appends or retains `herdr-instructions` entries. Any worker-session instruction entry is scoped to that worker and is not copied into the main session.
11. `session_shutdown` cancels or detaches the background claim worker, clears in-memory gate state, and leaves worker cleanup to the supported session API.

Instruction text and block-message text remain unchanged, but instruction delivery moves to the worker session. A worker failure leaves the main gate active and emits a concise user notification without copying worker instructions or worker results into the main prompt.

## Error and Security Rules

- Use `execFileSync` with command and argument arrays; never build shell command strings for execution.
- Keep allow-list matching strict and reject compound commands before matching.
- Treat command output as untrusted text; parse JSON defensively.
- Do not expose session paths, socket data, or synchronization internals in model context.
- Do not let Herdr gate errors disable existing Todoist-gate behavior.
- Do not delete, overwrite, or mutate Herdr-managed files during package installation.

## Testing Strategy

Convert the external Herdr test file to Vitest conventions and place it at `test/herdr-claim-gate.test.ts`. Preserve coverage for:

- linked-worktree automatic rename;
- descriptive-tab and non-worktree worker behavior;
- command failures and incomplete metadata;
- allowed inspection commands;
- full instruction delivery inside the worker session;
- no instruction injection into the main session;
- no worker startup for dispatched subagents;
- no worker status/result delivered to the main session agent;
- no `herdr-instructions` entry in main-session context/history;
- worker startup/completion and failure behavior;
- worker prompt contains user prompt only in worker process;
- worker output/status never enters main-session events or context;
- gate blocking and lifting through rename, move, and descriptive tab result;
- persisted marker resume behavior;
- strict rejection of chaining and substitutions.

Extend `test/git.test.ts` to prove shared path/branch helpers and ensure existing worktree behavior remains unchanged. Extend `test/extension.test.ts` only as needed to prove composed entry does not affect Todoist activation semantics.

All production behavior follows TDD: write focused failing tests, observe expected failure, implement minimal behavior, then run focused and full checks.

Required verification:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```

## Files

### Create

- `src/herdr-claim-gate.ts`
- `src/herdr-claim-worker.ts`
- `test/herdr-claim-gate.test.ts`
- `test/herdr-claim-worker.test.ts`
- `docs/herdr-claim-gate-migration.md`

### Modify

- `extensions/pi-todo-gate.ts`
- `src/shared/project.ts`
- `test/git.test.ts`
- `test/extension.test.ts` only if composition coverage requires it

### Do not modify

- `~/.pi/agent/extensions/herdr-agent-state.ts`
- `~/.pi/agent/extensions/herdr-claim-gate.ts`
- project instruction files

## Migration

After installing the versioned package and confirming tests, manually remove the old unversioned `~/.pi/agent/extensions/herdr-claim-gate.ts` and its external test file. Leaving the old extension active causes duplicate gate handlers. The migration note must state this plainly and explain that `herdr-agent-state.ts` remains separately managed by Herdr.

## Delivery

Implementation completes only after focused tests, full tests, typecheck, lint, and `git diff --check` pass. Then push `integrate-herdr-gate` to origin and create a GitHub PR against `master`. Review PR comments before any merge.

## Non-Goals

- Owning Herdr agent-state reporting.
- Changing Herdr CLI behavior or skill text.
- Making Todoist activation global.
- Adding Herdr configuration UI.
- Automatically deleting or backing up user files.
- Refactoring unrelated task-gate modules.
