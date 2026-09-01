# Herdr Tab Naming Integration Design

## Status

Superseded historical design. Current implementation is documented below; older blocking-gate requirements in this file are no longer applicable.

## Current Implementation

`pi-todo-gate` provides non-blocking Herdr tab naming only. It does not enforce a claim gate.

- Main extension entry remains `extensions/pi-todo-gate.ts`.
- Herdr behavior is installed independently from Todoist/PR activation.
- Non-subagent detection requires `PI_SUBAGENT_CHILD === "1"` to disable extension startup.
- Subagent sessions do not register extensions or start Herdr workers.
- Worktree-based automatic tab naming is attempted first.
- Successful worktree naming skips background worker startup.
- Fallback naming uses one isolated background `pi --mode json` worker.
- Worker receives Herdr instructions; main session receives no worker prompt or output.
- Worker failure produces notification only.
- Herdr never blocks tools, modifies active-tool allowlists, or gates main-session work.
- Session shutdown does not leave blocking handlers behind.

## Current Herdr Flow

1. On session start, inspect Herdr environment and current tab/worktree state.
2. If linked worktree naming can claim the tab, rename it and persist claim evidence.
3. Otherwise start fallback worker with isolated arguments:

```text
pi --mode json -p --no-extensions --no-context-files --tools bash \
  --append-system-prompt <tab-naming-instructions> <worker-prompt>
```

4. Worker derives task-based label, performs tab naming, and reports only completion/failure notification.
5. Main session continues independently throughout.

Task-derived naming remains retained. It is fallback behavior, not authorization enforcement.

## Isolation and Safety

- Never register package extensions in worker/subagent sessions.
- Never inject Herdr instructions into main prompt context or session history.
- Execute Herdr commands with argument arrays, not shell interpolation.
- Treat Herdr output as untrusted.
- Worker process must not inherit a path that causes recursive package loading.
- Worker completion must not block normal tool execution.

## Todoist/PR Boundary

Herdr tab naming and Todoist/PR behavior have separate activation decisions. Herdr naming may run for an eligible Herdr session even when no Todoist project is configured. Todoist/PR behavior remains project-scoped.

## Removed Behavior

The original design proposed a blocking `herdr-claim-gate` with command allowlists, tool interception, gate state, and claim-worker instructions in a gated workflow. That design was rejected. The following are removed and must not be reintroduced:

- `installHerdrClaimGate`
- gate-active state
- active-tool blocking or allowlist enforcement
- Herdr command interception
- blocking claim instructions in the main session
- legacy `herdr-claim-gate` production modules

## Verification

Herdr tests cover automatic worktree naming, fallback worker behavior, strict subagent detection, worker isolation, unchanged descriptive-label validation, stale callback protection, and failure notifications. Required repository checks:

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```

## Migration

The legacy unversioned `~/.pi/agent/extensions/herdr-claim-gate.ts` must be removed manually after installing this package. Keep `~/.pi/agent/extensions/herdr-agent-state.ts`; Herdr owns that file.
