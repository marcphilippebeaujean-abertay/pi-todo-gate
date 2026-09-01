# Exit protocol

Pi Todo Gate handles PR merges and session close through one shared exit protocol.

- Merge and quit actions appear in one combined prompt.
- Actions start selected; `Submit` starts focused.
- Todoist action: `Mark Todoist task "<task>" complete`.
- Worktree action: `Delete worktree "<path>" and local branch "<branch>"`.
- Worktree removal changes into main checkout first and deletes only local worktree and branch.
- Dirty worktrees require explicit force-removal confirmation.
- Merged worktree cleanup is deferred until quit.
- Unchanged worktrees auto-delete on quit and notify `Worktree deleted because no changes were made`.
- Active Todoist tasks still prompt when unchanged worktree auto-deletion occurs.
- `/new`, `/resume`, `/fork`, and `/reload` do not complete tasks or delete worktrees.
- Failed actions retain state for a later attempt.
