---
name: merge-protocol
description: Guides safe, user-confirmed pull request merging and optional Todoist completion.
---

# Merge protocol

Use this skill when the user clearly intends to merge a pull request without using
`/merge`.

1. Load the active pi-todo-gate session state and use only its pinned PR URL.
2. Stop and ask the user to pin a PR if no pinned PR exists. Do not infer a target
   from repository state, a branch name, or a natural-language number.
3. Ask for explicit confirmation before running the merge command.
4. After confirmation, run exactly `gh pr merge <url> --merge` for the pinned URL.
5. Stop and report the failure if the command fails. Do not claim that the PR was
   merged when the command did not succeed.
6. After a successful merge, let the extension's verified `prMerged` event consumer
   ask the separate Todoist completion question when an assigned task exists.

Do not complete Todoist directly. Never bypass the merge confirmation or merge an
unpinned or ambiguous PR.
