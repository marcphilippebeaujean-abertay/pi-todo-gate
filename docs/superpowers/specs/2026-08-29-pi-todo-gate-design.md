# pi-todo-gate Design

## Status

Approved design for standalone Pi extension project.

- Project: `/Users/marcphilippebeaujean/Documents/pi-todo-gate`
- Remote: `https://github.com/marcphilippebeaujean-abertay/pi-todo-gate.git`
- Todoist integration: `td` CLI
- Activation: explicit coding-project configuration only

## Purpose

Connect one Pi coding session to one GitHub pull request and one Todoist task. Keep those links visible, preserve them across session handoff, enforce configurable Todoist task claiming, complete the task after the associated PR is merged, and synchronize Pi task tracking with Todoist subtasks without exposing synchronization mechanics to the agent.

The extension is session-scoped. It must not create global PR/task ownership or infer a task from unrelated repositories.

## Activation and Configuration

The extension is fully inert unless the current working directory or one of its parents matches a configured coding project.

Configuration is stored at:

`~/.pi/agent/pi-todo-gate.json`

Example:

```json
{
  "projects": {
    "/Users/marcphilippebeaujean/Documents/tower-chess": "merge-td"
  }
}
```

Rules:

1. Resolve `ctx.cwd` and walk toward filesystem root.
2. Select the nearest configured ancestor.
3. The mapped value identifies the Todoist project by name or `id:<id>`.
4. No matching ancestor means no extension behavior: no tools, commands, footer, prompt injection, PR detection, Git hooks, or Todoist calls.
5. Project configuration is the only activation gate; there is no catch-all default project.
6. Configuration loading and matching must be deterministic and read-only during startup.

A future configuration command may edit this file, but configuration UI is outside the initial feature scope.

## Session State

The active state is stored in Pi custom session entries:

```ts
type WorkState = {
  prUrl?: string;
  taskUrl?: string;
  taskRef?: string;
  inheritedFrom?: string; // previous Pi session ID
  mergeCompletedAt?: string;
  todoistCompletionAttemptedAt?: string;
};
```

State rules:

- Latest state entry on the active branch wins.
- `inheritedFrom` stores the previous session ID, never a filesystem path.
- On `session_start`, restore state from the current session first.
- If current session has no state and `previousSessionFile` exists, open that session, read its latest state, and copy the pair into the new session.
- Current session state always wins over inherited state.
- Inherited state causes one hidden context addition on the first agent prompt:
  `This is the task and PR that we were working on.` plus the two links.
- State remains until the agent explicitly changes or clears it.
- Old state must not reactivate after explicit clearing.
- Forks follow the same previous-session inheritance rule unless the target already has state.

## Pull Request Tracking

GitHub PR URLs use this shape:

`https://github.com/<owner>/<repo>/pull/<number>`

Automatic discovery:

- Scan current session history oldest-to-newest.
- Inspect user, assistant, tool-result, and bash-execution text.
- First valid GitHub PR URL wins.
- Later URLs never replace an existing value.
- Extension-generated synchronization content must not participate in discovery.

Agent control is explicit through an LLM-callable `pi_todo_gate_state` tool:

```text
status
set_pr(url)
clear_pr
set_task(todoistRef)
clear_task
clear_all
```

`set_pr` is the explicit override to first-wins discovery. URL validation is required before persistence.

## Todoist Task Claiming

`set_task` accepts a Todoist task URL, ID, or resolvable reference. It must:

1. Resolve the configured Todoist project for the coding project.
2. Run `td task view <ref> --json`.
3. Reject tasks outside the configured project.
4. Detect whether task is already in `In Progress`.
5. Reject a task already in progress unless it was claimed by this session.
6. Move a valid task to `In Progress` using `td task move`.
7. Store canonical task URL and task reference.

When no active task exists, every real user prompt receives this hidden agent-context warning:

`you have no claimed a todoist task yet!`

The warning does not block work. It is omitted when a task is active.

## Worktree PR Guidance

Worktree detection uses Git commands, not Herdr state:

- `git rev-parse --show-toplevel`
- `git worktree list --porcelain`
- `git branch --show-current`

The extension tracks whether the session has performed meaningful work. Changes may be observed from successful edit/write tool results and Git state changes after tool results.

On each user prompt, when all conditions hold:

- current directory is a linked worktree;
- session has made work changes;
- current branch has no open GitHub PR;
- configured project is active;

inject concise guidance telling the agent to push the branch and create a PR when implementation is finished.

This is guidance only. The extension never pushes or creates a PR automatically. If `gh` or a remote is unavailable, inject an actionable diagnostic instead.

Open PR lookup uses the current branch and `gh pr list`/`gh pr view`. Lookup failures must not crash the session.

## Merge Completion

Inspect successful `bash` `tool_result` events. Candidate commands:

- `git merge ...`
- `gh pr merge ...`

A command must succeed before completion is attempted. The extension must conservatively verify that the merge target corresponds to the pinned PR. Ambiguous targets produce a diagnostic and do not complete Todoist.

On a verified merge:

1. Run `td task complete <taskUrl>`.
2. Record completion attempt/idempotency state.
3. Notify the agent of success or failure.
4. Keep PR/task links pinned until the agent explicitly changes them.

No task completion occurs when no task or PR is active.

## Hidden Two-Way Pi Task Synchronization

The active Todoist task is the parent of the Pi task list. The parent description is never modified.

### Outbound: Pi to Todoist

Trigger after successful `TaskCreate`, `TaskUpdate`, `TaskStop`, or `TaskExecute` results, and again at `agent_settled`. Debounce triggers into one sync.

The installed `@tintinweb/pi-tasks` release has no public task-update event bus. The adapter uses its documented file-backed session store as the integration boundary:

`<coding-project>/.pi/tasks/tasks-<session-id>.json`

The adapter reads the `TaskStoreData` shape without importing private package classes.

Sync algorithm:

1. Read current Pi tasks.
2. Recursively list all existing Todoist descendants of the active parent.
3. Delete descendants deepest-first.
4. Recreate every Pi task as a direct Todoist subtask.
5. Encode status in each subtask title:
   - `[ ]` pending
   - `[~]` in progress
   - `[x]` completed
6. Preserve subject and description; include dependency references where representable.
7. Report success or partial failure through a normal notification only.

This intentionally deletes all existing descendants, including manually-created subtasks, before recreation.

No sync command, custom message, `sendMessage`, context injection, or prompt text may reveal this mechanism to the agent.

### Inbound: Todoist to Pi

On `session_start` and session inheritance:

1. Fetch all Todoist descendants for the active parent.
2. Todoist is authoritative on restore.
3. Clear local Pi tasks.
4. Recreate local Pi tasks from Todoist subtasks.
5. Refresh the normal Pi task widget without adding context messages.

When the agent changes the active Todoist task through `set_task`:

1. Detach the old parent without modifying or deleting its Todoist subtasks.
2. Clear the current session's local Pi task list.
3. Fetch the new parent's descendants.
4. Recreate the local Pi task list from the new parent's subtasks.
5. Leave the local Pi task list empty when the new Todoist task has no subtasks.

This supports: “Task X is selected; switch to Todoist task Y.” The old Todoist task remains unchanged. Future outbound sync applies only to task Y. If Todoist lookup fails, preserve local state and report synchronization failure.

Default file-backed session scope is supported first. `PI_TASKS=off`, memory scope, or incompatible custom paths must be detected and reported as unavailable; the extension must not silently overwrite unrelated files.

Internal local writes must not generate visible agent tool calls or synchronization loops.

## Footer

Interactive TUI only. When active, use `ctx.ui.setFooter()` and Pi TUI `hyperlink()`/OSC 8 links.

Example:

```text
PR #42  Task: Implement authentication  |  branch: feature/auth
```

Rules:

- PR and Todoist labels are clickable.
- Missing values render as `PR: none` or `Task: none`.
- Preserve existing extension statuses through `footerData.getExtensionStatuses()`, including pi-caveman.
- Re-render after state and branch changes.
- Keep footer compact; no animation or custom editor.
- Non-TUI modes receive hidden context and notifications only.

The custom footer replaces Pi’s built-in footer while active. This tradeoff is explicit and must be covered by manual TUI validation.

## Error Handling and Safety

- Invoke `git`, `gh`, and `td` with argument arrays; never interpolate untrusted values into shell commands.
- Treat CLI output as untrusted text.
- Missing authentication or binaries yields diagnostics, not thrown extension failures.
- Todoist deletion/recreation is sequential and debounced.
- Partial synchronization records failure and never claims success.
- Repeated merge events are idempotent.
- State writes are serialized.
- Inactive projects perform no external calls.

## Project Layout

```text
/Users/marcphilippebeaujean/Documents/pi-todo-gate/
  package.json
  extensions/pi-todo-gate.ts
  src/config.ts
  src/session-state.ts
  src/pr-detection.ts
  src/git.ts
  src/todoist.ts
  src/pi-tasks-sync.ts
  src/footer.ts
  test/
  install.sh
```

The package uses a standalone repository and an install script that symlinks its extension directory into `~/.pi/agent/extensions/`. It may later add a Pi package manifest, but initial installation remains local and explicit.

## Verification Criteria

Unit tests must cover:

- nearest configured ancestor and fully inert unmatched projects;
- config parsing and Todoist project resolution;
- PR extraction and first-wins behavior;
- explicit PR override and clears;
- session restore and previous-session inheritance;
- exact missing-task warning behavior;
- Todoist project/section claim validation;
- worktree and open-PR detection;
- guidance conditions and suppression;
- merge target matching and idempotency;
- Todoist CLI success/failure handling;
- Pi-task serialization, status mapping, and two-way conversion;
- descendant deletion ordering;
- sync debounce and loop prevention;
- footer link rendering and width safety;
- headless mode behavior.

Manual TUI verification must confirm clickable PR/task footer links, Caveman status coexistence, session handoff, worktree reminder, and merge completion notification.

## Non-Goals

- Automatic PR creation or pushing.
- Todoist REST API support.
- Cross-session global task ownership.
- Non-GitHub pull-request providers.
- Changes to `AGENTS.md` or other project instruction files.
- Modifying the `@tintinweb/pi-tasks` package in the initial project.
