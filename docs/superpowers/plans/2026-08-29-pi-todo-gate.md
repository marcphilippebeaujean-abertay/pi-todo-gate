# Pi Todo Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicitly configured, session-scoped Pi extension that links GitHub PRs and Todoist tasks, guides worktree PR completion, and silently synchronizes Pi task lists with Todoist subtasks.

**Architecture:** A lazy-activated TypeScript extension resolves the nearest configured coding-project ancestor before registering behavior. Pure adapters isolate configuration, session state, URL parsing, Git inspection, Todoist CLI calls, Pi task-store conversion, and footer rendering. Runtime hooks coordinate those adapters while keeping synchronization out of model context.

**Tech Stack:** TypeScript, Node.js built-ins, Pi ExtensionAPI, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`, `vitest`, `td`, `git`, and `gh`.

**Spec:** `/Users/marcphilippebeaujean/Documents/pi-todo-gate/docs/superpowers/specs/2026-08-29-pi-todo-gate-design.md`

## Global Constraints

- Project root: `/Users/marcphilippebeaujean/Documents/pi-todo-gate`.
- Remote: `https://github.com/marcphilippebeaujean-abertay/pi-todo-gate.git`.
- Extension is fully inert unless current `ctx.cwd` or a parent directory is configured.
- Nearest configured coding-project ancestor wins; there is no catch-all default project.
- Active PR/task state is session-scoped and persisted through Pi custom entries.
- First GitHub PR URL found in session history wins; explicit agent `set_pr` overrides it.
- Todoist task links are agent-controlled only.
- Todoist integration uses `td` CLI, never the REST API.
- Active task must belong to resolved configured Todoist project and be claimed in `In Progress`.
- Successful matching `git merge` and `gh pr merge` may complete the active Todoist task.
- Worktree guidance reminds but never pushes or creates a PR automatically.
- Pi-task synchronization emits no context message, custom message, sync tool call, or prompt text.
- Outbound sync deletes all Todoist descendants under active parent before recreation.
- Inbound restore treats Todoist subtasks as authoritative and replaces local Pi tasks.
- Old Todoist parent and its subtasks remain unchanged when active task switches.
- Invoke external commands with argument arrays; never interpolate untrusted values into shell commands.
- Write tests before production code and demonstrate each new behavior failing first.
- No changes to `AGENTS.md` or other project instruction files.

## File Map

### Create

- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/package.json` — package metadata, Pi manifest, scripts, peer/dev dependencies.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/tsconfig.json` — strict TypeScript configuration for source, extension, and tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/extensions/pi-todo-gate.ts` — Pi factory, lazy activation, event wiring, tool and command registration.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/types.ts` — shared domain types and command result types.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/config.ts` — configuration parsing and nearest-ancestor resolution.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/session-state.ts` — state reconstruction and serialized state transitions.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/pr-detection.ts` — GitHub PR URL extraction and first-wins scanning.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/git.ts` — Git/worktree/branch/open-PR probes and merge matching.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/todoist.ts` — `td` command adapter, project validation, task claim, completion, and subtree operations.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/pi-tasks-sync.ts` — documented Pi task-store reader/writer and Pi↔Todoist task conversion.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/footer.ts` — compact clickable footer component and status preservation.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/config.test.ts` — activation/config tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/session-state.test.ts` — state and inheritance tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/pr-detection.test.ts` — URL tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/git.test.ts` — worktree/PR/merge tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/todoist.test.ts` — CLI argument and claim tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/pi-tasks-sync.test.ts` — conversion, replacement, deletion-order, and loop tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/footer.test.ts` — hyperlink and width tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/extension.test.ts` — mocked Pi lifecycle integration tests.
- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/install.sh` — explicit local installation/symlink script.

### Modify

- `/Users/marcphilippebeaujean/Documents/pi-todo-gate/docs/superpowers/specs/2026-08-29-pi-todo-gate-design.md` only if implementation discovers a real contract discrepancy; any modification requires spec re-review.

## Task 1: Scaffold package and test harness

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/package.json`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/tsconfig.json`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/config.test.ts`

**Interfaces:**
- Produces npm scripts `test`, `typecheck`, and `lint` for later tasks.
- Produces strict compiler settings that accept extension `.ts` imports used by Pi’s jiti loader.

- [ ] **Step 1: Write failing harness test**

Create one test proving the test runner works and asserting a future exported helper is not yet present through a placeholder-free test fixture. Use a temporary test-only `assert.equal(1 + 1, 2)` smoke test, then replace it with the first real configuration test in Task 2.

- [ ] **Step 2: Run harness test**

Run:

```bash
cd /Users/marcphilippebeaujean/Documents/pi-todo-gate
npm test -- --run test/config.test.ts
```

Expected: PASS for the temporary harness smoke test.

- [ ] **Step 3: Create package metadata**

Set package metadata with:

```json
{
  "name": "pi-todo-gate",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "biome check extensions src test"
  },
  "keywords": ["pi-package", "pi-extension", "todoist", "git"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "latest",
    "@types/node": "latest",
    "@biomejs/biome": "latest",
    "typebox": "latest",
    "typescript": "latest",
    "vitest": "latest"
  },
  "pi": {
    "extensions": ["./extensions/pi-todo-gate.ts"]
  }
}
```

Use the installed Pi package version when lockfile resolution selects an available version; do not bundle Pi peer dependencies.

- [ ] **Step 4: Create strict compiler configuration**

Configure `/Users/marcphilippebeaujean/Documents/pi-todo-gate/tsconfig.json` with `target` and `module` set to modern Node-compatible values, `moduleResolution: "Bundler"`, `strict: true`, `noEmit: true`, `esModuleInterop: true`, `skipLibCheck: true`, and includes for `extensions`, `src`, and `test`.

- [ ] **Step 5: Install dependencies and run checks**

Run:

```bash
cd /Users/marcphilippebeaujean/Documents/pi-todo-gate
npm install
npm test
npm run typecheck
```

Expected: smoke test PASS, typecheck PASS.

- [ ] **Step 6: Commit scaffold**

```bash
cd /Users/marcphilippebeaujean/Documents/pi-todo-gate
git add package.json package-lock.json tsconfig.json test/config.test.ts
git commit -m "chore: scaffold pi todo gate extension"
```

## Task 2: Implement activation configuration

**Files:**
- Modify: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/config.test.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/types.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/config.ts`

**Interfaces:**

```ts
export interface TodoistProjectMapping {
  projects: Record<string, string>;
}

export interface ResolvedProject {
  codingRoot: string;
  todoistProjectRef: string;
}

export function parseConfig(raw: string): TodoistProjectMapping;
export function resolveConfiguredProject(cwd: string, config: TodoistProjectMapping): ResolvedProject | null;
export async function loadConfig(path?: string): Promise<TodoistProjectMapping>;
```

- [ ] **Step 1: Write failing tests**

Cover:

```ts
it("resolves exact coding root");
it("resolves nearest configured parent");
it("does not select a distant sibling");
it("returns null for unconfigured project");
it("rejects malformed config without activating");
it("normalizes configured paths before matching");
```

Use temporary directories and platform path helpers. Assert nearest ancestor wins when both parent and child are configured.

- [ ] **Step 2: Run configuration tests**

```bash
cd /Users/marcphilippebeaujean/Documents/pi-todo-gate
npm test -- --run test/config.test.ts
```

Expected: FAIL because `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/config.ts` does not exist.

- [ ] **Step 3: Implement parser and resolver**

`parseConfig` must accept only an object with a `projects` object whose keys and values are non-empty strings. Invalid input returns `{ projects: {} }`.

`resolveConfiguredProject` must resolve `cwd`, compare path segments safely, walk from `cwd` to filesystem root, and return the first mapping. Do not match `/repo-one` against `/repo-one-other`.

`loadConfig` reads `~/.pi/agent/pi-todo-gate.json` by default, returns empty mapping for missing file, and never throws on malformed JSON.

- [ ] **Step 4: Run tests**

```bash
npm test -- --run test/config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: activate todo gate by coding project"
```

## Task 3: Implement session state and PR discovery

**Files:**
- Modify: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/types.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/session-state.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/pr-detection.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/session-state.test.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/pr-detection.test.ts`

**Interfaces:**

```ts
export interface WorkState {
  prUrl?: string;
  taskUrl?: string;
  taskRef?: string;
  inheritedFrom?: string;
  mergeCompletedAt?: string;
  todoistCompletionAttemptedAt?: string;
}

export function emptyWorkState(): WorkState;
export function applyStatePatch(state: WorkState, patch: Partial<WorkState>): WorkState;
export function latestState(entries: readonly unknown[]): WorkState;
export function extractInheritedState(entries: readonly unknown[]): WorkState | null;
export function githubPrUrl(text: string): string | null;
export function firstGithubPrUrl(texts: readonly string[]): string | null;
```

- [ ] **Step 1: Write failing state tests**

Cover latest custom state entry, explicit empty clear state, branch-only state entries, and inherited session ID preservation. Test that clear state does not fall back to older values.

- [ ] **Step 2: Write failing PR tests**

Cover valid `https://github.com/owner/repo/pull/42`, trailing punctuation, query/hash removal, invalid GitHub paths, non-GitHub URLs, and oldest-to-newest first-wins scanning.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run test/session-state.test.ts test/pr-detection.test.ts
```

Expected: FAIL because implementation modules are absent.

- [ ] **Step 4: Implement pure state functions**

Use a strict custom-entry shape guard. State reconstruction must scan active branch entries and accept only `type: "custom"`, `customType: "pi-todo-gate-state"`, and valid object data. `applyStatePatch` must support explicit `undefined` clearing through a dedicated `replaceState` path so old values cannot reappear.

- [ ] **Step 5: Implement PR parser**

Use `URL` parsing. Accept hostname `github.com` and pathname `/owner/repo/pull/<positive integer>`. Return normalized URL without query/hash. Extract from arbitrary text without following links or executing content.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- --run test/session-state.test.ts test/pr-detection.test.ts
npm run typecheck
git add src/types.ts src/session-state.ts src/pr-detection.ts test/session-state.test.ts test/pr-detection.test.ts
git commit -m "feat: track session work state and first pull request"
```

## Task 4: Implement Git, worktree, and merge probes

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/git.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/git.test.ts`

**Interfaces:**

```ts
export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export type Exec = (command: string, args: string[], options?: { timeout?: number; signal?: AbortSignal }) => Promise<CommandResult>;

export interface WorktreeInfo {
  isWorktree: boolean;
  root: string | null;
  branch: string | null;
}

export interface OpenPrInfo {
  url: string | null;
  state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

export async function inspectWorktree(exec: Exec, cwd: string): Promise<WorktreeInfo>;
export async function findOpenPr(exec: Exec, cwd: string, branch: string): Promise<OpenPrInfo>;
export function mergeCommand(command: string): { kind: "git" | "gh"; args: string[] } | null;
export async function matchesPinnedPr(exec: Exec, cwd: string, command: string, prUrl: string): Promise<boolean>;
```

- [ ] **Step 1: Write failing parser/probe tests**

Cover linked worktree versus main checkout, branch parsing, `git merge`, `gh pr merge`, quoted commands, chained commands, unrelated commands, and ambiguous merge targets.

- [ ] **Step 2: Run tests**

```bash
npm test -- --run test/git.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement worktree inspection**

Call `git rev-parse --show-toplevel`, `git branch --show-current`, and `git worktree list --porcelain`. Compare the current resolved root with the first worktree path. A linked worktree is any current path that is not the main worktree path.

- [ ] **Step 4: Implement open-PR lookup**

Call:

```text
gh pr list --head <branch> --state open --json url,state --limit 1
```

Parse only JSON output. Missing `gh`, nonzero exit, invalid JSON, or no result returns `state: "UNKNOWN"` or `url: null` without throwing.

- [ ] **Step 5: Implement merge matching**

Parse shell segments without treating quoted text as commands. For `gh pr merge`, accept pinned URL, matching PR number/repository, or current branch only after querying the pinned PR metadata. For `git merge`, query pinned PR head branch through `gh pr view <prUrl> --json headRefName` and compare normalized merge arguments. Return false on ambiguity.

- [ ] **Step 6: Run checks and commit**

```bash
npm test -- --run test/git.test.ts
npm run typecheck
git add src/git.ts test/git.test.ts
git commit -m "feat: detect worktrees and matching merges"
```

## Task 5: Implement Todoist CLI adapter and claiming

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/todoist.ts`
- Modify: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/types.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/todoist.test.ts`

**Interfaces:**

```ts
export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId?: string | null;
  sectionName?: string | null;
  parentId?: string | null;
  url?: string;
  webUrl?: string;
}

export interface TodoistChild extends TodoistTask {
  children?: TodoistChild[];
}

export interface TodoistExec {
  run(args: readonly string[]): Promise<CommandResult>;
}

export class TodoistClient {
  constructor(exec: TodoistExec);
  resolveProject(ref: string): Promise<{ id: string; name: string }>;
  getTask(ref: string): Promise<TodoistTask>;
  claimTask(ref: string, project: { id: string }): Promise<TodoistTask>;
  completeTask(ref: string): Promise<void>;
  listDescendants(ref: string): Promise<TodoistChild[]>;
  deleteDescendants(children: readonly TodoistChild[]): Promise<void>;
  createSubtask(parentRef: string, input: { content: string; description: string }): Promise<TodoistTask>;
}
```

- [ ] **Step 1: Write failing CLI tests**

Use a fake `TodoistExec` that records argument arrays. Cover project resolution by name and ID, task project mismatch, existing `In Progress` rejection, same-session claim acceptance, task move arguments, canonical URL selection, completion, recursive child listing, deepest-first deletion, and no shell interpolation.

- [ ] **Step 2: Run tests**

```bash
npm test -- --run test/todoist.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement command runner wrapper**

Use `td` as command and pass each argument separately. Treat nonzero exit as a typed `TodoistError` containing command family and sanitized stderr. Never include auth tokens in error text.

- [ ] **Step 4: Implement project and claim validation**

Resolve configured project once per coding root. `claimTask` fetches task JSON, compares `projectId`, resolves section name when necessary, and rejects tasks in `In Progress` unless caller passes the current session’s already-claimed task ID. Move valid tasks with:

```text
td task move <task-ref> --section In Progress --project id:<project-id>
```

Return `webUrl`, then `url`, then a constructed Todoist URL only when the CLI provides enough identity.

- [ ] **Step 5: Implement task lifecycle and descendants**

`completeTask` invokes `td task complete <task-ref>`. `listDescendants` recursively queries children. `deleteDescendants` flattens leaves-first and invokes `td task delete id:<id> --yes`. `createSubtask` invokes `td task add <content> --parent <parent-ref> --description <description>`.

- [ ] **Step 6: Run checks and commit**

```bash
npm test -- --run test/todoist.test.ts
npm run typecheck
git add src/types.ts src/todoist.ts test/todoist.test.ts
git commit -m "feat: claim and complete configured todoist tasks"
```

## Task 6: Implement hidden Pi-task store synchronization

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/pi-tasks-sync.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/pi-tasks-sync.test.ts`

**Interfaces:**

```ts
export interface PiTask {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  owner?: string;
  metadata: Record<string, unknown>;
  blocks: string[];
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PiTaskStoreData {
  nextId: number;
  tasks: PiTask[];
}

export function sessionTaskPath(cwd: string, sessionId: string): string;
export async function readPiTaskStore(path: string): Promise<PiTaskStoreData | null>;
export async function writePiTaskStore(path: string, data: PiTaskStoreData): Promise<void>;
export function todoistSubtasksToPiTasks(children: readonly TodoistChild[]): PiTaskStoreData;
export function piTasksToTodoistSubtasks(tasks: readonly PiTask[]): Array<{ content: string; description: string }>;
export async function syncPiTasksToTodoist(client: TodoistClient, parentRef: string, store: PiTaskStoreData): Promise<void>;
export async function syncTodoistToPiTasks(client: TodoistClient, parentRef: string, path: string): Promise<PiTaskStoreData>;
```

- [ ] **Step 1: Write failing conversion tests**

Cover status markers `[ ]`, `[~]`, `[x]`, subject/description preservation, owner/dependency metadata, stable IDs from an internal description marker, manually-created subtasks receiving new IDs, empty parent behavior, and malformed store rejection.

- [ ] **Step 2: Write failing sync-order tests**

Use fake Todoist client methods. Assert all descendants are deleted deepest-first before creation, no parent description update occurs, and a failed delete/create stops and reports failure.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run test/pi-tasks-sync.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement documented store access**

Use the default path `/active/coding/root/.pi/tasks/tasks-<session-id>.json`. Read `TaskStoreData`, normalize missing arrays and metadata, and reject unrelated JSON shapes. Write atomically through a sibling temporary file followed by rename. Refuse writes when `PI_TASKS=off`, memory scope, or an incompatible configured path is detected.

- [ ] **Step 5: Implement conversion**

Encode the Pi ID in a machine-readable private description line so inbound recreation can preserve identity. Prefix content with status marker. Store owner and dependency references in description lines. Do not add synchronization instructions or model-facing messages.

- [ ] **Step 6: Implement inbound/outbound sync**

Inbound clears/replaces local store only after all Todoist descendants have been fetched successfully. Outbound deletes all descendants, then creates direct subtasks. A parent with no children writes an empty task list. Use an in-process origin flag to prevent recursive sync scheduling.

- [ ] **Step 7: Run checks and commit**

```bash
npm test -- --run test/pi-tasks-sync.test.ts
npm run typecheck
git add src/pi-tasks-sync.ts test/pi-tasks-sync.test.ts
git commit -m "feat: synchronize pi tasks with todoist subtasks"
```

## Task 7: Implement footer renderer

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/src/footer.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/footer.test.ts`

**Interfaces:**

```ts
export interface FooterState {
  prUrl?: string;
  taskUrl?: string;
  branch?: string | null;
}

export function renderFooterLine(state: FooterState, width: number, theme: FooterTheme, statuses: ReadonlyMap<string, string>): string;
export function createFooterFactory(state: () => FooterState): FooterFactory;
```

- [ ] **Step 1: Write failing rendering tests**

Cover both clickable links, missing values, long URL labels, narrow widths, branch changes, and preserving Caveman status from `footerData.getExtensionStatuses()`.

- [ ] **Step 2: Run tests**

```bash
npm test -- --run test/footer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement compact footer**

Use `hyperlink()` from `@earendil-works/pi-tui` for URL labels. Use `visibleWidth` and `truncateToWidth`. Render only bounded labels such as `PR #42` and `Task`, never raw unbounded URLs. Include branch and existing extension statuses where width allows.

- [ ] **Step 4: Implement footer factory lifecycle**

Factory must expose `render`, `invalidate`, and `dispose`. Subscribe to `footerData.onBranchChange()` and request TUI render after state changes. Avoid timers and custom editors.

- [ ] **Step 5: Run checks and commit**

```bash
npm test -- --run test/footer.test.ts
npm run typecheck
git add src/footer.ts test/footer.test.ts
git commit -m "feat: show clickable work links in footer"
```

## Task 8: Wire extension lifecycle, agent tool, and hidden sync

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/extensions/pi-todo-gate.ts`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/extension.test.ts`

**Interfaces:**

```ts
export type WorkStateAction =
  | { action: "status" }
  | { action: "set_pr"; url: string }
  | { action: "clear_pr" }
  | { action: "set_task"; task: string }
  | { action: "clear_task" }
  | { action: "clear_all" };
```

- [ ] **Step 1: Write failing lifecycle tests**

Use a mocked `ExtensionAPI` and `ExtensionContext` to prove:

- unmatched cwd registers no behavior and performs no external call;
- matched cwd registers state tool and hooks;
- session start restores state and inherits previous session state;
- first history PR is pinned and later PRs are ignored;
- missing-task warning appears in `before_agent_start` only when task is absent;
- sync internals never call `sendMessage` or `sendUserMessage`;
- `set_task` clears local Pi tasks and loads new parent subtasks;
- outbound sync runs after task tool results and `agent_settled` with debounce;
- merge completion requires successful matching command;
- worktree guidance appears only after work changes and missing open PR;
- explicit PR override survives later automatic discovery.

- [ ] **Step 2: Run integration tests**

```bash
npm test -- --run test/extension.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement lazy activation**

At `session_start`, load config and resolve nearest ancestor. If no match, return without registering tools, commands, footer, or starting resources. For matched sessions, register `pi_todo_gate_state` exactly once per extension instance and activate it only in matched sessions.

- [ ] **Step 4: Implement state restoration and inheritance**

Restore current branch state. When current state is empty and `previousSessionFile` exists, open it using `SessionManager.open`, read previous state, set `inheritedFrom` to previous session ID, persist copied state in current session, and set a one-shot handoff flag. Never expose source file path.

- [ ] **Step 5: Implement hidden PR discovery**

Scan session branch message text during startup and finalized message events. On first valid PR URL with empty state, persist it and refresh footer. Ignore extension-generated state/sync entries.

- [ ] **Step 6: Implement agent state tool**

Use `Type.Object` plus `StringEnum` for action schema. `status` returns current PR/task and activation root. `set_pr` validates GitHub URL and persists override. `clear_pr` clears only PR. `set_task` calls Todoist claim validation, persists canonical task, clears local Pi tasks, and performs inbound sync from new parent. `clear_task` clears association and local Pi tasks without touching Todoist. `clear_all` clears both local associations and local Pi task store without changing remote Todoist subtasks.

Tool output may describe state mutation but must not describe hidden synchronization internals.

- [ ] **Step 7: Implement prompt guidance**

In `before_agent_start`, append only:

- exact missing-task warning when no task is active;
- one-time prior-session task/PR context;
- worktree push/create-PR guidance when matched conditions hold.

Do not mention Pi↔Todoist synchronization.

- [ ] **Step 8: Implement task and merge hooks**

On successful `tool_result` for `TaskCreate`, `TaskUpdate`, `TaskStop`, or `TaskExecute`, schedule outbound sync. On `agent_settled`, schedule one final sync. On successful bash result matching pinned merge, complete active Todoist task, persist idempotency metadata, and notify agent.

Track work changes from successful edit/write results and Git state changes. Cache open-PR lookup for the prompt turn to avoid duplicate network calls.

- [ ] **Step 9: Implement session and shutdown cleanup**

Install/update footer only in TUI. On session shutdown, clear footer, cancel pending sync timer, and release any resources. Do not start watchers or processes in the extension factory.

- [ ] **Step 10: Run integration checks and commit**

```bash
npm test -- --run test/extension.test.ts
npm run typecheck
npm run lint
git add extensions/pi-todo-gate.ts test/extension.test.ts
git commit -m "feat: wire session-aware todo gate extension"
```

## Task 9: Add installation and configuration workflow

**Files:**
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/install.sh`
- Modify: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/package.json`
- Create: `/Users/marcphilippebeaujean/Documents/pi-todo-gate/test/install-script.test.ts`

- [ ] **Step 1: Write failing install tests**

Test that installation target is derived from `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/pi-todo-gate`, existing target is handled without deleting unrelated files, and script refuses missing project extension directory.

- [ ] **Step 2: Run tests**

```bash
npm test -- --run test/install-script.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement safe install script**

Use `set -eu`, resolve the repository directory from the script location, create the extension parent directory, and create/update a symlink to the repository’s `extensions/pi-todo-gate.ts`. Refuse replacement of a non-symlink target unless an explicit `--force` argument is supplied. Do not edit settings automatically.

- [ ] **Step 4: Add configuration setup command**

Add a package script or shell helper that creates `~/.pi/agent/pi-todo-gate.json` only when explicitly requested. It must accept coding-root and Todoist project reference, preserve unrelated mappings, and write atomically. This helper does not run as part of extension startup.

- [ ] **Step 5: Run checks and commit**

```bash
npm test -- --run test/install-script.test.ts
npm run typecheck
npm run lint
git add install.sh package.json test/install-script.test.ts
git commit -m "feat: add explicit local installation workflow"
```

## Task 10: Full verification and manual TUI check

**Files:**
- Modify: tests only when a failing verification exposes missing behavior.

- [ ] **Step 1: Run complete automated suite**

```bash
cd /Users/marcphilippebeaujean/Documents/pi-todo-gate
npm test
npm run typecheck
npm run lint
git diff --check
git status --short --branch
```

Expected: all tests pass, strict typecheck passes, lint passes, no whitespace errors, and only intentional changes remain.

- [ ] **Step 2: Verify inactive project safety**

Run Pi from an unconfigured temporary directory with the extension installed. Confirm no footer, no custom tool, no Todoist/Git CLI calls, and no prompt additions.

- [ ] **Step 3: Verify configured TUI behavior**

Configure `/Users/marcphilippebeaujean/Documents/tower-chess` to Todoist project `merge-td`, start Pi in that project, and confirm:

- footer shows clickable PR/task labels after state is set;
- Caveman status remains visible;
- missing-task warning appears when task is cleared;
- `set_pr` changes automatic PR selection;
- `set_task` claims task and loads Todoist subtasks into Pi tasks;
- changing task preserves old Todoist subtasks and replaces local Pi tasks;
- Pi task updates recreate only new parent’s descendants;
- new-session inheritance shows task/PR context once;
- linked worktree with edits and no open PR receives push/create-PR guidance;
- successful matching local/remote merge completes Todoist parent and notifies agent.

- [ ] **Step 4: Inspect final diff and commit verification**

```bash
git diff --stat
git log --oneline --decorate -8
git status --short --branch
```

Commit any final test-only fixes separately with a focused message.

## Plan Self-Review

- Activation: Task 2 and Task 8 cover nearest ancestor, no default, and fully inert unmatched projects.
- Session state: Task 3 and Task 8 cover current restore, previous-session inheritance, explicit clears, and one-shot context.
- PR handling: Task 3 and Task 8 cover first-wins discovery and agent override.
- Todoist claiming: Task 5 and Task 8 cover configurable project validation, `In Progress`, completion, and failures.
- Worktree guidance: Task 4 and Task 8 cover worktree detection, changed-work tracking, open PR lookup, and non-mutating reminders.
- Merge completion: Task 4, Task 5, and Task 8 cover local/remote commands, conservative matching, idempotency, and notification.
- Hidden two-way sync: Task 6 and Task 8 cover hooks, direct store access, inbound authority, outbound replacement, loop prevention, and unsupported scopes.
- Footer: Task 7 and Task 8 cover OSC 8 links, width limits, TUI-only behavior, branch refresh, and Caveman compatibility.
- Safety: Tasks 4, 5, 6, and 8 cover argv-based commands, inactive no-op behavior, error preservation, and no context leakage.
- Installation: Task 9 covers local standalone deployment without automatic settings mutation.
- Verification: Task 10 covers automated and manual acceptance criteria.

Placeholder scan performed while writing: no `TBD`, `FIXME`, or incomplete implementation markers remain.
