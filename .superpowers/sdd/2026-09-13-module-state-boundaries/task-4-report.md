

## Fix round 1 review findings

Follow-up review findings addressed without widening Task 5 scope.

- Removed PR `event-consumers.ts` and `event-publishers.ts` public wildcard exports. `isCurrentMerge` remains implementation/test-internal.
- Removed Herdr event-consumer/publisher wildcard exports. Retained `installHerdrTabClaim` setup entrypoint and side-effect imports; worker handles/cancellation contracts are no longer entrypoint exports.
- Removed Todoist event-consumer/publisher wildcard exports. Internal operation APIs remain reachable only through module-local imports.
- Removed Worktree git helper re-exports; public entrypoint now retains cleanup capability and state/events exports only.
- Added Vitest setup that clears inherited `PI_SUBAGENT_CHILD` only inside tests. Production `isSubagent()` guard unchanged.
- Replaced `unknown` dependency fields and Todoist cast with precise types inferred from public factory/setup signatures.
- Updated tests to import implementation helpers from owning internal facets.

### Fix-round commands and output

```text
npx vitest run test/pr test/todoist test/worktree test/footer test/exit-protocol test/herdr
```

PASS — 20 test files, 178 tests. Passes with inherited `PI_SUBAGENT_CHILD=1`; no environment surgery.

```text
npm run typecheck
```

PASS — `tsc --noEmit`.

```text
npm run architecture
```

PASS — no dependency violations; 211 modules, 814 dependencies cruised.

```text
npm run lint:strict
```

PASS.

```text
npm run lint:biome
```

PASS — 193 files checked, no diagnostics.

```text
git diff --check
```

PASS.

Self-review confirmed no `export *` of scoped implementation event consumer/publisher facets from PR, Herdr, or Todoist entrypoints; no Worktree git-helper entrypoint exports; no public lifecycle methods restored. Fix round committed separately after validation.
