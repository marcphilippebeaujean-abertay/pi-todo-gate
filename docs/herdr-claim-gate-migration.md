# Herdr Tab Naming Migration

`pi-todo-gate` now versions background Herdr tab naming.

## Install

From repository root:

```bash
npm test
npm run typecheck
npm run lint
npm run install-local
```

Integrated Herdr setup starts an ephemeral background naming worker:

```text
pi --mode json -p --no-extensions --no-context-files --tools bash \
  --append-system-prompt <tab-naming-instructions> <worker-prompt>
```

Worker instructions and output stay inside worker process. User sees tab naming failures through notification only. Main agent continues normally; no tools are blocked.

## Legacy gate cleanup

`npm run install-local` does not remove obsolete files. Remove these legacy files manually when present:

```text
~/.pi/agent/extensions/herdr-claim-gate.ts
~/.pi/agent/extensions/tests/herdr-claim-gate.test.ts
```

Remove legacy gate before restarting Pi; otherwise its global blocking hooks remain active. Keep `~/.pi/agent/extensions/herdr-agent-state.ts`; Herdr manages that file and may overwrite local changes.

Restart Pi after installation. Confirm tab naming runs in background and main agent tools remain available.
