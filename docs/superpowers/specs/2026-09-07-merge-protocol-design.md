# Merge protocol design

## Goal

Add an explicit, user-confirmed merge protocol to pi-todo-gate. `/merge` executes the protocol immediately. A discoverable `merge-protocol` Agent Skill provides a backdoor for the agent to follow the same protocol when the user expresses standalone merge intent without using the command. Natural-language input is not pattern-matched by the extension.

Keep PR/GitHub concerns inside `src/pr/` while preserving module isolation. After a successful merge, publish an event consumed by Todoist. If an assigned Todoist task exists, ask whether to complete it. The event records whether completion was confirmed and succeeded.

## Decisions

- `/merge` is the only direct extension command. It does not send a prompt back to the agent for interpretation.
- `/merge` targets only the active session's pinned PR. Missing pinned PR stops with a notification.
- Merge operation uses `gh pr merge <pinned-url> --merge`.
- Merge confirmation precedes all merge commands.
- Todoist completion is a separate confirmation after successful merge.
- No assigned task means no Todoist prompt.
- `taskMarkedAsCompleted` starts `false` and becomes `true` only after confirmation and successful `td task complete`.
- Existing automatic tool-result merge detection remains as event-producing fallback for agent-initiated merges.
- Existing Todoist exit action is removed to prevent duplicate completion prompts. Worktree consumers may continue handling the merged event.

## Module boundaries

`src/pr/` owns:

- GitHub PR URL normalization and discovery.
- GitHub CLI PR lookup and state queries.
- Git and `gh pr merge` command parsing, target matching, and verified merge detection.
- PR lifecycle integration that emits verified `prMerged` events.
- PR state and PR-specific display data; footer rendering consumes display data through the extension boundary.

Move PR-specific legacy files into this directory, including the contents represented by `git-pr`, `git-merge`, `pr-detection`, and shared merge parsing/matching helpers. Remove obsolete root compatibility files after imports migrate.

Keep generic command execution in `src/shared/command.ts`. Keep repository/worktree inspection in `src/shared/project.ts` and `src/worktree/`. These are Git-backed infrastructure, not PR-domain APIs.

Other feature modules must not import `src/pr/`. Extension composition is the boundary caller. Footer code owns its PR display adapter and receives normalized PR display state through existing runtime/footer state rather than importing PR internals. Dependency-cruiser rules enforce forbidden PR consumers, including Todoist, Herdr, shared domain code, footer internals, and feature tests.

## Event contract

The shared `prMerged` payload is:

```ts
{
  prUrl: string;
  taskMarkedAsCompleted: boolean;
}
```

The PR producer emits the exact normalized/pinned URL with `taskMarkedAsCompleted: false`. Todoist consumes the event and may set only the completion flag. It sets the flag after the user accepts the completion prompt and the Todoist completion command succeeds.

Event listeners remain isolated: a Todoist failure must not prevent other listeners, and a missing task must not create a prompt. Existing session-generation and operation-current checks protect state from stale asynchronous work.

## Direct command flow

The registered `/merge` handler:

1. Verifies an active configured session and interactive UI.
2. Reads the active pinned PR URL.
3. Notifies and stops when no pinned PR exists.
4. Asks `Merge PR <url>?`.
5. Stops without side effects on decline.
6. Runs `gh pr merge <url> --merge` with argument arrays and session `cwd`.
7. Notifies failure and emits no event when the command fails or rejects.
8. Emits `prMerged` with `taskMarkedAsCompleted: false` after success.
9. Lets Todoist's event consumer ask its separate completion question.

The command path is serialized with session operations and invalidated on session replacement/shutdown.

## Agent Skill flow

Add `skills/merge-protocol/SKILL.md` with valid Agent Skills frontmatter:

- `name: merge-protocol`
- description states that it guides safe, user-confirmed PR merging and optional Todoist completion.

Instructions tell the agent to load session state, use only the pinned PR, ask explicit confirmation before running `gh pr merge <url> --merge`, stop on failure, and never complete Todoist directly. After an agent-run merge, the extension's verified tool-result detection emits the same event; the Todoist event consumer owns the one completion question.

The extension does not inspect normal `input` text for `merge`. The agent decides when to load the skill. Pi discovers the skill through the package's `skills/` convention and exposes `/skill:merge-protocol` when skill commands are enabled.

## Todoist flow

Replace the current merge-triggered Todoist exit action with a `prMerged` consumer. On event receipt:

- Verify active session and assigned `taskRef`.
- Snapshot task identity and operation generation.
- Ask `Mark Todoist task "<task>" complete?` only when a task exists and UI is available.
- On decline, leave the event flag false and preserve task state.
- On confirmation, call `TodoistClient.completeTask` with current-operation checks.
- On success, set `taskMarkedAsCompleted = true`, persist completion metadata, and refresh footer.
- On failure or stale operation, leave the flag false and notify appropriately.

No Todoist state mutation happens before explicit completion confirmation.

## Error handling

- Inactive/unconfigured session, no UI, or missing pinned PR: notification and no merge command.
- Merge confirmation decline: no event.
- Merge CLI failure: warning with bounded stderr detail and no event.
- Todoist decline: successful merge remains recorded; task remains assigned.
- Todoist failure: warning, false completion flag, and retryable task state.
- Session replacement/shutdown invalidates pending protocol and completion operations.

## Testing

Add focused tests for:

- PR/Git migration and absence of obsolete imports.
- Module-boundary dependency-cruiser rules.
- Direct `/merge` success, decline, failure, inactive session, no UI, and missing pinned PR.
- Event payload initialization and Todoist completion-flag transitions.
- Todoist prompt suppression without an assigned task and failure/decline behavior.
- Skill frontmatter and protocol requirements.
- Existing PR discovery, merge matching, worktree, Todoist, and lifecycle behavior.

Required verification: `npm test`, `npm run typecheck`, `npm run lint`, and `git diff --check`.
