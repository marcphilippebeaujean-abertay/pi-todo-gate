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
pi --mode json -p --no-session --no-extensions <worker-prompt>
```

Worker instructions and output stay inside worker process. User sees completion or failure through notification only. Main agent receives no Herdr context, message, status, or result, and its tool calls are never blocked while worker runs.

## Remove legacy gate

After installing and verifying package, manually remove old unversioned files:

```text
~/.pi/agent/extensions/herdr-claim-gate.ts
~/.pi/agent/extensions/tests/herdr-claim-gate.test.ts
```

Leaving old `herdr-claim-gate.ts` active causes duplicate gate handlers. Installer does not remove global files automatically.

Keep `~/.pi/agent/extensions/herdr-agent-state.ts`. Herdr manages that file and may overwrite local changes.

Restart Pi after cleanup. Confirm Herdr claim completion produces user notification and no Herdr instructions or worker output appear in main agent context.
