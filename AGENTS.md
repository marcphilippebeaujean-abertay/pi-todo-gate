# Agent guidance

## Control flow

Prefer `switch` when dispatching multiple mutually exclusive cases from one discriminant value. Use guard-clause `if` statements for independent validation or conditions with different predicates. Keep condition aliases readable; lint recognizes repeated equality dispatch through named boolean assignments.

## Session-bound background work

Do not add repeated session-identity checks around ordinary read-only background work. For irreversible external mutations, use shared session-action guard at final dispatch and publish one session notification when dispatch is skipped or state synchronization is affected. Never pass originating `ExtensionContext` to notify a later session.
