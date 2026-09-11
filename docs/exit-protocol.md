# Exit protocol

Pi Todo Gate handles PR merges through one shared exit protocol.

- Merge actions appear in one combined prompt.
- Actions start selected; `Submit` starts focused.
- Todoist action: `Mark Todoist task "<task>" complete`.
- Successful Todoist completion clears the task state and removes the task link from the footer.
- Worktree action: `Delete worktree "<path>" and local branch "<branch>"`.
- Worktree removal changes into main checkout first and deletes only local worktree and branch.
- Dirty worktrees require explicit force-removal confirmation.
- Selecting merged worktree cleanup removes it immediately.
- Session shutdown performs no worktree cleanup or interactive prompting.
- `/new`, `/resume`, `/fork`, and `/reload` do not complete tasks or delete worktrees.
- If worktree removal succeeds but branch deletion fails, the failure is reported without a later retry.
