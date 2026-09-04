# Strict and Structured Linting Design

## Goal

Add repository lint rules for explicit string constants, readable boolean conditions, and maintainable function structure. Integrate these rules into `npm run lint` while keeping existing Biome checks.

## Scope

Lint production TypeScript files in:

- `extensions/**/*.ts`
- `src/**/*.ts`, excluding `src/lint.ts`, `src/lint-config.ts`, and `src/lint-cli.ts`

Tests validate checker behavior through Vitest and remain covered by Biome, but are not targets of the custom rules. The checker runs only as a repository development tool. It does not inspect user projects at runtime.

## Rules

### `no-magic-strings`

String literals within function bodies must be extracted into named `const` declarations before use. A direct string initializer in a `const` declaration is an allowed constant definition. Top-level constant declarations are also allowed.

Ignore module specifiers, directives, property names, and type-only syntax. The checker reports executable string literals that are not constant definitions.

Example:

```ts
if (name === "Bob") return true;
```

fails. This passes:

```ts
const USER_NAME = "Bob";
if (name === USER_NAME) return true;
```

### `no-short-string-constants`

Named string constants must contain at least two characters. This rule is separate from `no-magic-strings`: direct `const` initializers are valid magic-string definitions, but one-character and empty definitions are rejected as non-descriptive constants. Inline one-character literals remain exempt because they commonly represent deliberate character tokens.

### `no-complicated-expressions`

Count leaf checks in logical boolean expressions joined by `&&` and `||`. Report expressions with three or more checks. Parentheses and unary negation do not reduce the count.

`a && (b || c)` contains three checks and fails. Two checks pass.

### `named-if-condition`

An `if` condition must be a boolean identifier, optionally negated. Numeric comparisons, arithmetic, calls, logical combinations, and other computed conditions must first be assigned to a local boolean with an intent-revealing name. TypeScript built-in type guards (`typeof`, nullish checks, `in`, `instanceof`, and `Array.isArray`) remain inline because their expression form enables compiler narrowing.

```ts
const hasAccountBalance = accountBalance > 0;
if (hasAccountBalance) {
  // ...
}
```

The TypeScript type checker determines whether identifier conditions are boolean-like or object guards. The rule does not enforce a naming prefix because intent naming is semantic and cannot be reliably inferred; its diagnostic instructs the author to choose a descriptive boolean name.

### `cyclomatic-complexity`

For each function-like construct, start at complexity 1 and add one for each `if`, loop, `catch`, conditional expression, switch case, and logical operator. Report values greater than 10.

Count declarations, methods, accessors, function expressions, and arrow functions independently, including nested functions.

### `function-length`

Count source lines from each function-like construct's opening start through its closing end. Report functions longer than 50 lines.

### `functions-per-file`

Count all function-like constructs in a file, including declarations, methods, accessors, function expressions, and arrow functions. Report files containing more than 10 functions.

### `nested-function-depth`

Count function nesting depth independently from cyclomatic complexity. A top-level function has depth 1; a function declared inside it has depth 2. Report functions deeper than 2. Function-like constructs include declarations, methods, accessors, function expressions, and arrow functions.

## Architecture

`src/lint.ts` exposes the checker API and owns TypeScript AST traversal, rule evaluation, diagnostics, and sorting. It creates no files and performs no automatic fixes.

`src/lint-config.ts` owns defaults and optional `lint.config.json` overrides. Defaults are:

```json
{
  "maxCyclomaticComplexity": 10,
  "maxFunctionLines": 50,
  "maxFunctionsPerFile": 10,
  "maxNestedFunctionDepth": 2,
  "maxBooleanChecks": 2
}
```

`src/lint-cli.ts` discovers production TypeScript files under `extensions` and `src`, excluding the lint infrastructure modules, loads `tsconfig.json`, creates a TypeScript program and type checker, invokes `lintProgram()`, prints diagnostics, and exits with status 1 when violations exist.

`package.json` changes `lint` to run Biome followed by the custom checker. `tsconfig.json` includes the new checker modules.

## Diagnostics

Each diagnostic includes:

```text
path/to/file.ts:line:column rule-id message (value; limit)
```

Diagnostics sort by normalized file path, source position, then rule ID. Parser and TypeScript diagnostics remain visible. Rule violations are collected rather than thrown, so one run reports all findings.

Malformed or unreadable optional lint configuration falls back to defaults. Missing source files are handled as an empty file set; TypeScript program diagnostics still report compiler issues.

## Testing

`test/lint.test.ts` uses temporary fixture files or in-memory source inputs through the exported checker API. Tests cover:

- string literals that fail, direct `const` definitions that pass, and short string constants that fail;
- ignored module/property/type syntax;
- two-check and three-check boolean boundaries;
- boolean identifiers, negated booleans, numeric truthiness, and comparison extraction;
- complexity at 10 and 11;
- function length at 50 and 51 lines;
- file function count at 10 and 11;
- nested-function depth at 2 and 3;
- deterministic diagnostic ordering and formatting;
- config overrides and malformed config fallback.

The full Vitest suite, TypeScript typecheck, Biome check, and custom lint command must pass after existing production source is refactored to satisfy the new limits. Test files remain outside custom-rule scope.

## Refactoring strategy

Implement and test the checker first. Wire it into the lint command, observe failures, then refactor existing code without changing behavior:

1. extract repeated executable strings into nearby named constants;
2. extract complex and non-boolean `if` conditions into descriptive booleans;
3. split functions over 50 lines at cohesive boundaries;
4. split production files over 10 functions only where module boundaries remain clear;
5. flatten production functions deeper than two levels where module boundaries remain clear;
6. reduce complexity by extracting decision-heavy helpers.

Run the focused lint tests after each rule, then run the complete verification suite.
