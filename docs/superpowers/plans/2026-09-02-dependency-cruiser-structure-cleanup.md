# Dependency Cruiser and Module Structure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace handwritten dependency-boundary checks with dependency-cruiser, group remaining source modules by domain, and mirror that organization in tests.

**Architecture:** Keep one extension composition root. Organize source into `src/pr`, `src/todoist`, `src/herdr`, and `src/shared`; organize tests into matching domain folders plus `test/extensions`. Dependency-cruiser becomes source and test import-boundary authority.

**Tech Stack:** TypeScript, Vitest, Biome, dependency-cruiser, npm.

**Spec:** `docs/superpowers/specs/2026-08-30-independent-pr-todoist-modules-design.md`

## Global Constraints

- One installed Pi extension remains the runtime entrypoint.
- PR, Todoist, and Herdr domains never import each other.
- Shared code imports no domain code.
- Extension composition root may compose independent domains.
- Domain tests remain under their matching domain folder.
- Dependency-cruiser is the only import-boundary checker; remove the duplicate handwritten scanner.
- No runtime behavior change beyond import paths and cleanup.
- Do not delete files until all imports and test references are migrated.
- Verify `npm run architecture`, `npm test`, `npm run typecheck`, and `npm run lint`.

---

### Task 1: Install and configure dependency-cruiser

**Files:**
- Create: `.dependency-cruiser.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `test/architecture.test.ts`

**Interfaces:**
- Produces `npm run architecture` as the single dependency-boundary command.
- Rules cover `src/pr`, `src/todoist`, `src/herdr`, `src/shared`, `test/pr`, `test/todoist`, `test/herdr`, and `test/extensions`.

- [ ] **Step 1: Add dependency-cruiser dependency**

Run:

```bash
npm install --save-dev dependency-cruiser
```

- [ ] **Step 2: Add failing architecture command**

Add this script to `package.json` before implementation of config rules:

```json
"architecture": "depcruise --config .dependency-cruiser.cjs src extensions test"
```

- [ ] **Step 3: Configure forbidden dependency rules**

Create `.dependency-cruiser.cjs` with CommonJS export and rules for:

```js
module.exports = {
  forbidden: [
    { name: "no-pr-to-todoist", severity: "error", from: { path: "^src/pr/" }, to: { path: "^src/todoist/" } },
    { name: "no-pr-to-herdr", severity: "error", from: { path: "^src/pr/" }, to: { path: "^src/herdr/" } },
    { name: "no-todoist-to-pr", severity: "error", from: { path: "^src/todoist/" }, to: { path: "^src/pr/" } },
    { name: "no-todoist-to-herdr", severity: "error", from: { path: "^src/todoist/" }, to: { path: "^src/herdr/" } },
    { name: "no-herdr-to-pr", severity: "error", from: { path: "^src/herdr/" }, to: { path: "^src/pr/" } },
    { name: "no-herdr-to-todoist", severity: "error", from: { path: "^src/herdr/" }, to: { path: "^src/todoist/" } },
    { name: "no-shared-to-pr", severity: "error", from: { path: "^src/shared/" }, to: { path: "^src/pr/" } },
    { name: "no-shared-to-todoist", severity: "error", from: { path: "^src/shared/" }, to: { path: "^src/todoist/" } },
    { name: "no-shared-to-herdr", severity: "error", from: { path: "^src/shared/" }, to: { path: "^src/herdr/" } },
    { name: "no-pr-test-to-todoist", severity: "error", from: { path: "^test/pr/" }, to: { path: "^src/todoist/" } },
    { name: "no-pr-test-to-herdr", severity: "error", from: { path: "^test/pr/" }, to: { path: "^src/herdr/" } },
    { name: "no-todoist-test-to-pr", severity: "error", from: { path: "^test/todoist/" }, to: { path: "^src/pr/" } },
    { name: "no-todoist-test-to-herdr", severity: "error", from: { path: "^test/todoist/" }, to: { path: "^src/herdr/" } },
    { name: "no-herdr-test-to-pr", severity: "error", from: { path: "^test/herdr/" }, to: { path: "^src/pr/" } },
    { name: "no-herdr-test-to-todoist", severity: "error", from: { path: "^test/herdr/" }, to: { path: "^src/todoist/" } },
    { name: "no-circular", severity: "error", from: { path: "^(src|extensions)/" }, to: { circular: true } },
    { name: "no-orphans", severity: "error", from: { path: "^src/" }, to: { orphan: true } }
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: { extensions: [".ts", ".js", ".json"] }
  }
};
```

Adjust only syntax required by installed dependency-cruiser version. Keep all rules explicit.

- [ ] **Step 4: Make tests run architecture validation first**

Change `package.json` test script to:

```json
"test": "npm run architecture && vitest run"
```

- [ ] **Step 5: Run architecture command and record failures**

Run:

```bash
npm run architecture
```

Expected: command executes and reports current layout/import violations, if any. Do not weaken rules to hide migration failures.

- [ ] **Step 6: Commit tooling setup**

```bash
git add .dependency-cruiser.cjs package.json package-lock.json
git commit -m "chore: enforce module boundaries with dependency-cruiser"
```

---

### Task 2: Group Herdr source modules

**Files:**
- Create: `src/herdr/claim-gate.ts`
- Create: `src/herdr/claim-worker.ts`
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `extensions/index.ts` if needed
- Modify: imports in tests and remaining source files
- Delete after migration: `src/herdr-claim-gate.ts`, `src/herdr-claim-worker.ts`

**Interfaces:**
- Preserves all existing exports from both Herdr files.
- New imports use `../src/herdr/claim-gate.ts` and `../src/herdr/claim-worker.ts` from extensions/tests.

- [ ] **Step 1: Add path-preserving Herdr files**

Copy each existing Herdr file into `src/herdr/` without behavior changes. Update only relative imports required by the new directory depth.

- [ ] **Step 2: Update all importers**

Run:

```bash
rg -n 'herdr-claim-(gate|worker)' --glob '!node_modules/**'
```

Update every source/test import to the matching `src/herdr/...` path.

- [ ] **Step 3: Run Herdr tests**

Run:

```bash
npx vitest run test/herdr-claim-gate.test.ts test/herdr-claim-worker.test.ts
```

Expected: PASS before test files move.

- [ ] **Step 4: Remove old Herdr files**

Delete old flat files only after `rg` returns no references.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Herdr layout**

```bash
git add src extensions test
 git commit -m "refactor: group Herdr modules"
```

---

### Task 3: Mirror source layout in tests

**Files:**
- Move: `test/pr-detection.test.ts` → `test/pr/detection.test.ts`
- Move/split: `test/git.test.ts` → `test/pr/git.test.ts` and `test/shared/project.test.ts`
- Move/split: `test/footer.test.ts` → `test/pr/footer.test.ts` and `test/todoist/footer.test.ts`
- Move: `test/session-state.test.ts` → `test/shared/session-state.test.ts`
- Move: `test/todoist.test.ts` → `test/todoist/client.test.ts`
- Move: `test/config.test.ts` → `test/todoist/config.test.ts`
- Move: `test/herdr-claim-gate.test.ts` → `test/herdr/claim-gate.test.ts`
- Move: `test/herdr-claim-worker.test.ts` → `test/herdr/claim-worker.test.ts`
- Move: `test/extension.test.ts` → `test/extensions/pi-todo-gate.test.ts`
- Keep: existing `test/pr/*`, `test/todoist/*`, `test/shared/*`
- Keep or move: `test/install-script.test.ts` under `test/install/` only if its imports remain correct

**Interfaces:**
- Test behavior and assertions remain unchanged except import paths.
- Each test file imports only source from its corresponding domain or shared infrastructure, except extension integration tests.

- [ ] **Step 1: Move single-domain tests**

Use `mkdir` and `mv`, not rewrites, for detection, session-state, client, config, and Herdr tests. Update relative imports after moves:

```bash
mkdir -p test/pr test/todoist test/shared test/herdr test/extensions
mv test/pr-detection.test.ts test/pr/detection.test.ts
mv test/session-state.test.ts test/shared/session-state.test.ts
mv test/todoist.test.ts test/todoist/client.test.ts
mv test/config.test.ts test/todoist/config.test.ts
mv test/herdr-claim-gate.test.ts test/herdr/claim-gate.test.ts
mv test/herdr-claim-worker.test.ts test/herdr/claim-worker.test.ts
mv test/extension.test.ts test/extensions/pi-todo-gate.test.ts
```

- [ ] **Step 2: Split mixed Git tests**

Place PR URL/PR Git/merge matching assertions in `test/pr/git.test.ts`. Place project-root/worktree inspection assertions in `test/shared/project.test.ts`. Update imports to `../../src/pr/git.ts`, `../../src/shared/project.ts`, and `../../src/shared/command.ts`.

- [ ] **Step 3: Split mixed footer tests**

Place PR rendering assertions in `test/pr/footer.test.ts`; place Todoist rendering assertions in `test/todoist/footer.test.ts`. Use domain-local imports.

- [ ] **Step 4: Fix moved test relative paths**

Run:

```bash
rg -n '\.\./src|\.\./\.\./src|herdr-claim|pr-detection|test/(git|footer|config|todoist|session-state)' test extensions src --glob '*.ts'
```

Update stale paths. Do not change production behavior.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: architecture command passes, then all Vitest tests pass.

- [ ] **Step 6: Commit test layout**

```bash
git add test
 git commit -m "refactor: mirror domain structure in tests"
```

---

### Task 4: Cleanup validation and documentation

**Files:**
- Modify: `README.md` only if repository adds one during cleanup; otherwise document command in `package.json` and config comments.
- Modify: `.dependency-cruiser.cjs` only for verified resolver/rule corrections.
- Delete: obsolete architecture scanner already removed in Task 1.

**Interfaces:**
- Produces clean repository with no stale flat module/test paths, no duplicate architecture checker, and reproducible checks.

- [ ] **Step 1: Search obsolete paths and duplicate tooling**

Run:

```bash
rg -n 'test/architecture|src/herdr-claim|src/(git|pr-detection|todoist|config|footer|session-state|types)|dependency-cruiser|depcruise' --glob '!node_modules/**'
```

Expected: only intended dependency-cruiser config/script/docs remain; no obsolete source/test imports remain.

- [ ] **Step 2: Check tracked file layout**

Run:

```bash
find src test extensions -type f | sort
git status --short
```

Expected: domain files live under matching folders; no accidental generated files.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run architecture
npm test
npm run typecheck
npm run lint
git diff --check HEAD~4..HEAD
```

Expected: all commands exit 0 and diff check reports no whitespace errors.

- [ ] **Step 4: Review dependency graph output**

Run:

```bash
npx depcruise --config .dependency-cruiser.cjs src extensions test --output-type err-long
```

Expected: no forbidden, circular, orphan, or unresolved internal dependency violations.

- [ ] **Step 5: Commit verified cleanup corrections**

```bash
git add .dependency-cruiser.cjs package.json package-lock.json src extensions test docs/superpowers/plans/2026-09-02-dependency-cruiser-structure-cleanup.md
git commit -m "chore: finish module structure cleanup"
```
