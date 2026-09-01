# Herdr Claim Gate Migration

`pi-todo-gate` now versions custom Herdr claim enforcement.

## Install

From repository root:

```bash
npm test
npm run typecheck
npm run lint
npm run install-local
```

Integrated Herdr setup starts an ephemeral background worker:

```text
pi --mode json -p --no-extensions <worker-prompt>
```

Worker instructions and output stay inside worker process. User sees completion or failure through notification only. Main agent receives no Herdr context, message, status, or result, and its tool calls are never blocked while worker runs.

## Legacy gate cleanup

`npm run install-local` does not remove obsolete files. Remove these legacy files manually when present:

```text
~/.pi/agent/extensions/herdr-claim-gate.ts
~/.pi/agent/extensions/tests/herdr-claim-gate.test.ts
```

This prevents duplicate Herdr gate handlers. Keep `~/.pi/agent/extensions/herdr-agent-state.ts`; Herdr manages that file and may overwrite local changes.

Restart Pi after installation. Confirm Herdr claim completion produces user notification and no Herdr instructions or worker output appear in main agent context.
