# Strict and Structured Linting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TypeScript AST lint rules for magic strings, complicated boolean expressions, non-intentful `if` conditions, cyclomatic complexity, function length, functions per file, and nested-function depth; make the existing repository pass them; push a feature branch and open a GitHub PR.

**Architecture:** A custom checker uses the TypeScript compiler API and type checker. `src/lint.ts` owns traversal and rules, `src/lint-config.ts` owns validated thresholds, and `src/lint-cli.ts` provides the command-line adapter. Biome remains the first lint stage; the custom checker runs second and returns a nonzero status for violations.

**Tech Stack:** TypeScript 6, TypeScript compiler API, Node.js, Vitest, Biome, `tsx` CLI runner.

**Spec:** `docs/superpowers/specs/2026-08-31-strict-structured-linting-design.md`

## Global Constraints

- Lint only production files in `extensions/**/*.ts` and `src/**/*.ts`, excluding `src/lint.ts`, `src/lint-config.ts`, and `src/lint-cli.ts`; tests remain Biome/Vitest-only.
- String literals inside function bodies require named `const` extraction; direct `const` initializers are allowed.
- Boolean expressions with three or more logical leaf checks violate `no-complicated-expressions`.
- `if` conditions must be boolean identifiers, optionally negated; numeric comparisons, arithmetic, calls, and other computed conditions require extraction into descriptive booleans; compiler type guards remain inline.
- Cyclomatic complexity limit is 10.
- Function length limit is 50 source lines.
- Functions-per-file limit is 10.
- Nested-function depth limit is 2, with top-level functions at depth 1.
- Diagnostics sort by normalized path, source position, then rule ID.
- Malformed optional config falls back to defaults.
- No automatic source edits.
- Every implementation change starts with a failing test and ends with a passing focused test.
- Never push `master` or `main`; push current feature branch and create PR against `master`.

---

### Task 1: Add lint configuration and checker contracts

**Files:**
- Create: `src/lint-config.ts`
- Create: `src/lint.ts`
- Test: `test/lint-config.test.ts`
- Test: `test/lint.test.ts`

**Interfaces:**
- `LintConfig` has `maxCyclomaticComplexity`, `maxFunctionLines`, `maxFunctionsPerFile`, `maxNestedFunctionDepth`, and `maxBooleanChecks`, all numbers.
- `DEFAULT_LINT_CONFIG: LintConfig` contains `10`, `50`, `10`, `2`, and `2` respectively.
- `loadLintConfig(path?: string): Promise<LintConfig>` reads optional JSON and accepts only positive integer overrides.
- `LintDiagnostic` has `filePath`, `line`, `column`, `ruleId`, `message`, `value`, and `limit`.
- `lintProgram(program: ts.Program, config?: Partial<LintConfig>): LintDiagnostic[]` checks all non-declaration TypeScript source files in the program.
- `formatLintDiagnostic(diagnostic: LintDiagnostic): string` returns `file:line:column rule-id message (value; limit)`.

- [ ] **Step 1: Write failing config tests**

```ts
const DEFAULTS = {
  maxCyclomaticComplexity: 10,
  maxFunctionLines: 50,
  maxFunctionsPerFile: 10,
  maxNestedFunctionDepth: 2,
  maxBooleanChecks: 2,
};

test("uses strict lint defaults when config is absent", async () => {
  await expect(loadLintConfig("missing-lint.config.json")).resolves.toEqual(DEFAULTS);
});

test("ignores malformed and non-positive overrides", async () => {
  await writeFile("lint.config.json", JSON.stringify({ maxFunctionLines: 0, maxFunctionsPerFile: "11" }));
  await expect(loadLintConfig("lint.config.json")).resolves.toMatchObject(DEFAULTS);
});
```

- [ ] **Step 2: Run focused config tests and verify expected failure**

Run: `npx vitest run test/lint-config.test.ts`
Expected: FAIL because `src/lint-config.ts` and `loadLintConfig()` do not exist.

- [ ] **Step 3: Implement config defaults and validation**

Use `readFile` and `JSON.parse`; merge only finite positive integer properties into `DEFAULT_LINT_CONFIG`; catch read and parse errors and return a fresh defaults object.

- [ ] **Step 4: Add failing diagnostic contract test**

```ts
test("formats diagnostics with stable location and threshold", () => {
  expect(formatLintDiagnostic({
    filePath: "src/example.ts",
    line: 4,
    column: 7,
    ruleId: "function-length",
    message: "Function exceeds maximum length",
    value: 51,
    limit: 50,
  })).toBe("src/example.ts:4:7 function-length Function exceeds maximum length (51; 50)");
});
```

- [ ] **Step 5: Run focused contract test and verify expected failure**

Run: `npx vitest run test/lint.test.ts -t "formats diagnostics"`
Expected: FAIL because the checker contract is not implemented.

- [ ] **Step 6: Implement exported checker types, empty traversal, diagnostic formatting, and deterministic sorting**

Create a TypeScript program in tests using temporary `.ts` fixtures. Have `lintProgram()` return sorted diagnostics and skip declaration files. Keep rule implementation empty until later tasks.

- [ ] **Step 7: Run focused tests and commit**

Run: `npx vitest run test/lint-config.test.ts test/lint.test.ts`
Expected: PASS.

```bash
git add src/lint-config.ts src/lint.ts test/lint-config.test.ts test/lint.test.ts
git commit -m "feat: add lint checker contracts"
```

### Task 2: Implement magic-string and boolean-expression rules

**Files:**
- Modify: `src/lint.ts`
- Modify: `test/lint.test.ts`

**Interfaces:**
- Add rule IDs `no-magic-strings` and `no-complicated-expressions` to `LintRuleId`.
- `no-magic-strings` reports executable string literals inside function bodies unless the literal is the direct initializer of a `const` variable declaration. Ignore imports, directives, property names, and type nodes.
- `no-complicated-expressions` counts leaves under `&&` and `||`; report the outermost logical expression when count exceeds `config.maxBooleanChecks`.

- [ ] **Step 1: Add failing fixture tests**

```ts
const MAGIC_SOURCE = `function check(name: string) {
  return name === "Bob";
}`;
const CONSTANT_SOURCE = `function check(name: string) {
  const USER_NAME = "Bob";
  return name === USER_NAME;
}`;
const TWO_CHECKS = `function check(a: boolean, b: boolean) { return a && b; }`;
const THREE_CHECKS = `function check(a: boolean, b: boolean, c: boolean) { return a && (b || c); }`;

test("flags executable string literals but permits const definitions", () => {
  expect(ruleIds(lintFixture(MAGIC_SOURCE))).toContain("no-magic-strings");
  expect(ruleIds(lintFixture(CONSTANT_SOURCE))).not.toContain("no-magic-strings");
});

test("flags three logical checks but permits two", () => {
  expect(ruleIds(lintFixture(THREE_CHECKS))).toContain("no-complicated-expressions");
  expect(ruleIds(lintFixture(TWO_CHECKS))).not.toContain("no-complicated-expressions");
});
```

- [ ] **Step 2: Run tests and verify expected failures**

Run: `npx vitest run test/lint.test.ts -t "string literals|logical checks"`
Expected: FAIL because both rules currently emit no diagnostics.

- [ ] **Step 3: Implement magic-string traversal**

Track function depth while visiting. For each string literal in a function body, skip import/module nodes, directive prologues, property names, type nodes, and direct `const` initializer literals; emit one diagnostic at the literal otherwise. Visit nested functions independently.

- [ ] **Step 4: Run magic-string tests**

Run: `npx vitest run test/lint.test.ts -t "string literals"`
Expected: PASS.

- [ ] **Step 5: Implement logical leaf counting**

For each outermost `BinaryExpression` using `&&` or `||`, recursively count logical operands; report only that outermost node when count exceeds `maxBooleanChecks`. Do not report nested logical nodes separately.

- [ ] **Step 6: Run expression tests and commit**

Run: `npx vitest run test/lint.test.ts -t "logical checks"`
Expected: PASS.

```bash
git add src/lint.ts test/lint.test.ts
git commit -m "feat: enforce explicit strings and simple expressions"
```

### Task 3: Implement named-if-condition rule

**Files:**
- Modify: `src/lint.ts`
- Modify: `test/lint.test.ts`

**Interfaces:**
- Add rule ID `named-if-condition`.
- A condition passes when it is an identifier whose apparent type is boolean, or a prefix `!` applied to such an identifier.
- A condition fails for comparisons, arithmetic, calls, logical expressions, conditional expressions, and identifiers with non-boolean apparent types.

- [ ] **Step 1: Add failing condition tests**

```ts
const IF_SOURCE = `function check(accountBalance: number, isClosed: boolean, count: number) {
  if (accountBalance > 0) return true;
  if (isClosed) return false;
  if (!isClosed) return false;
  if (count) return true;
  return false;
}`;

test("requires named boolean conditions", () => {
  const diagnostics = lintFixture(IF_SOURCE);
  expect(ruleIds(diagnostics).filter((id) => id === "named-if-condition")).toHaveLength(2);
});
```

- [ ] **Step 2: Run test and verify expected failure**

Run: `npx vitest run test/lint.test.ts -t "named boolean conditions"`
Expected: FAIL because the rule is not implemented.

- [ ] **Step 3: Implement type-aware condition validation**

Use `program.getTypeChecker()` and `getTypeAtLocation()` for identifiers. Accept only boolean types (including boolean unions); reject numeric/string/object truthiness. Emit one diagnostic at each invalid `if` condition with message instructing extraction into a descriptive local boolean.

- [ ] **Step 4: Run focused tests and commit**

Run: `npx vitest run test/lint.test.ts -t "named boolean conditions"`
Expected: PASS.

```bash
git add src/lint.ts test/lint.test.ts
git commit -m "feat: require named if conditions"
```

### Task 4: Implement function metrics and nested depth

**Files:**
- Modify: `src/lint.ts`
- Modify: `test/lint.test.ts`

**Interfaces:**
- Add rule IDs `cyclomatic-complexity`, `function-length`, `functions-per-file`, and `nested-function-depth`.
- Recognize declarations, methods, accessors, function expressions, and arrow functions.
- Complexity starts at 1 and counts `if`, loops, `catch`, conditional expressions, switch cases, and logical operators; nested function bodies are measured independently.
- Function line span uses the function-like node's start and end source lines.
- Nested depth uses top-level depth 1 and increments for function declarations/expressions nested in another function.

- [ ] **Step 1: Add failing metric boundary tests**

```ts
const COMPLEX_SOURCE = `function complex(value: number) {
  if (value > 0 && value < 10) { for (const item of [value]) { if (item) { try { return item; } catch { return 0; } } } }
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  if (value === 5) return 5;
  return 0;
}`;
const NESTED_SOURCE = `function outer() { const one = () => { const two = () => { const three = () => true; return three(); }; return two(); }; return one(); }`;

test("reports complexity, length, function count, and nested depth over limits", () => {
  const diagnostics = lintFixture(`${COMPLEX_SOURCE}\n${NESTED_SOURCE}`, {
    maxCyclomaticComplexity: 1,
    maxFunctionLines: 1,
    maxFunctionsPerFile: 1,
    maxNestedFunctionDepth: 2,
  });
  expect(ruleIds(diagnostics)).toEqual(expect.arrayContaining([
    "cyclomatic-complexity",
    "function-length",
    "functions-per-file",
    "nested-function-depth",
  ]));
});
```

- [ ] **Step 2: Run tests and verify expected failures**

Run: `npx vitest run test/lint.test.ts -t "complexity, length, function count"`
Expected: FAIL because metric rules are not implemented.

- [ ] **Step 3: Implement function discovery and per-file count**

Create one function record for every supported function-like node. Emit one `functions-per-file` diagnostic at the file start when count exceeds the configured maximum.

- [ ] **Step 4: Implement line length and nesting depth**

Use `sourceFile.getLineAndCharacterOfPosition(node.getStart())` and the node end position. Emit at function start when line count or nesting depth exceeds its limit.

- [ ] **Step 5: Implement cyclomatic counting**

Walk each function body while skipping nested function bodies. Count control-flow syntax and logical operators exactly once. Emit measured complexity and limit at function start.

- [ ] **Step 6: Run metric tests and commit**

Run: `npx vitest run test/lint.test.ts -t "complexity, length, function count"`
Expected: PASS.

```bash
git add src/lint.ts test/lint.test.ts
git commit -m "feat: enforce function structure limits"
```

### Task 5: Add CLI and package integration

**Files:**
- Create: `src/lint-cli.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/lint-cli.test.ts`

**Interfaces:**
- `collectLintFiles(root: string): string[]` returns sorted production `.ts` files under `extensions` and `src`, excluding the three lint infrastructure modules.
- CLI reads `tsconfig.json`, optional `lint.config.json`, creates a `ts.Program`, prints compiler diagnostics and custom diagnostics, and exits 1 when either exists.

- [ ] **Step 1: Add failing file-discovery and command tests**

```ts
test("collects only scoped TypeScript files in stable order", () => {
  expect(collectLintFiles(fixtureRoot)).toEqual([
    join(fixtureRoot, "extensions/example.ts"),
    join(fixtureRoot, "src/example.ts"),
  ]);
});
```

Add an executable fixture containing one magic string and assert the command output contains `no-magic-strings` and exits nonzero; add a clean fixture and assert exit zero.

- [ ] **Step 2: Run CLI tests and verify expected failure**

Run: `npx vitest run test/lint-cli.test.ts`
Expected: FAIL because `collectLintFiles()` and CLI entrypoint do not exist.

- [ ] **Step 3: Implement CLI and direct `tsx` dependency**

Use `tsx src/lint-cli.ts` in the package script. Set `lint` to `biome check extensions src test && tsx src/lint-cli.ts`. The CLI custom checker excludes test files and `src/lint*.ts`; add `tsx` as a direct dev dependency so the script does not depend on a transitive install.

- [ ] **Step 4: Run CLI tests and commit**

Run: `npx vitest run test/lint-cli.test.ts`
Expected: PASS.

```bash
git add src/lint-cli.ts package.json package-lock.json test/lint-cli.test.ts
git commit -m "build: integrate custom lint command"
```

### Task 6: Refactor existing repository code to pass strict lint

**Files:**
- Modify: `extensions/pi-todo-gate.ts`
- Modify: `src/*.ts` files with reported violations
- Modify: production files under `extensions/` and `src/` with reported violations

**Interfaces:**
- Preserve all existing exported functions, extension events, tool names, messages, and test behavior.
- Do not refactor test files or `src/lint*.ts` for custom-rule compliance.
- New helper modules may be created when splitting production files keeps each file below 11 functions.

- [ ] **Step 1: Run complete lint and capture baseline**

Run: `npm run lint`
Expected: Biome passes or reports its existing findings; custom checker reports all strict-rule violations. Save no generated baseline file.

- [ ] **Step 2: Add regression tests for behavior before structural refactors**

Run: `npm test`
Expected: existing suite passes before refactors. If a behavior regression is found during refactoring, add a focused failing test in the affected existing test file before changing production code.

- [ ] **Step 3: Extract executable string literals**

For each `no-magic-strings` finding, add a nearby module-level `const` with an intent-revealing uppercase name for shared protocol text or a local `const` for function-specific values. Replace only the literal use; preserve output text exactly.

- [ ] **Step 4: Extract condition expressions**

For each `named-if-condition` or `no-complicated-expressions` finding, assign the expression to a descriptive boolean immediately before its use. Split three-plus-check expressions into named predicates when one alias would hide multiple decisions.

- [ ] **Step 5: Split long and complex functions**

Extract cohesive helpers with explicit parameters and return types. Keep event registration behavior unchanged. Move independent concerns from `extensions/pi-todo-gate.ts` into focused `src` modules when needed.

- [ ] **Step 6: Split files and flatten nested functions**

Move helpers to modules when a file exceeds 10 functions. Replace functions nested deeper than depth 2 with module-level helpers or sibling helpers that receive captured values explicitly.

- [ ] **Step 7: Run lint and tests after each refactor group**

Run: `npm run lint && npm test`
Expected: no custom diagnostics and all tests pass. Repeat until clean.

- [ ] **Step 8: Commit baseline cleanup**

```bash
git add extensions src package.json package-lock.json
git commit -m "refactor: satisfy strict lint rules"
```

### Task 7: Final verification, review, push, and PR

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run required verification commands**

Run:

```bash
npm run typecheck
npm test
npm run lint
```

Expected: all commands exit 0 with no unexpected warnings. Inspect `git diff HEAD~` and `git status --short` for accidental files or behavior changes.

- [ ] **Step 2: Run focused lint boundary suite again**

Run: `npx vitest run test/lint-config.test.ts test/lint.test.ts test/lint-cli.test.ts`
Expected: PASS, including all threshold boundaries and diagnostic ordering checks.

- [ ] **Step 3: Request code review before integration**

Review changed files for rule semantics, TypeScript API safety, exact message preservation, and no generated artifacts. Resolve every finding and rerun all verification commands.

- [ ] **Step 4: Push feature branch**

```bash
git push -u origin add-strict-and-structured-linting
```

Expected: branch push succeeds; do not push `master` or `main`.

- [ ] **Step 5: Create GitHub PR**

```bash
gh pr create --base master --head add-strict-and-structured-linting --title "feat: add strict structured linting" --body "## Summary
- add custom TypeScript AST lint rules
- enforce readable expressions and function structure
- refactor repository to pass new checks

## Verification
- npm run typecheck
- npm test
- npm run lint"
```

Expected: GitHub returns PR URL. Check PR comments before any merge action; do not merge automatically.
