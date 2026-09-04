# Herdr Claim Gate Integration Implementation Plan

## Status

Superseded by current implementation. Original plan proposed blocking Herdr claim enforcement; current implementation provides non-blocking tab naming only.

## Current Implementation Update

Herdr integration now:

- runs from composed `extensions/pi-todo-gate.ts` entry;
- requires `PI_SUBAGENT_CHILD === "1"` to skip subagent startup;
- attempts worktree-based tab naming first;
- skips worker startup after successful worktree naming;
- uses isolated background worker only as fallback;
- keeps worker instructions and output out of main-session context;
- reports worker failure through notification only;
- never blocks tools or modifies active-tool allowlists.

Removed from implementation:

- blocking claim gate state;
- tool interception and command allowlists;
- `installHerdrClaimGate`;
- main-session claim instructions;
- legacy `herdr-claim-gate` production modules.

See current design: `docs/superpowers/specs/2026-08-30-herdr-claim-gate-integration-design.md`.

## Verification

```bash
npm test
npm run typecheck
npm run lint
git diff --check
```
