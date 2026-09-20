# Agent guidance

## Control flow

Prefer `switch` when dispatching multiple mutually exclusive cases from one discriminant value. Use guard-clause `if` statements for independent validation or conditions with different predicates. Keep condition aliases readable; lint recognizes repeated equality dispatch through named boolean assignments.

## ADR: state-driven asynchronous modules

**Status:** accepted — 2026-09-20. Reference implementation: PR #62.

- Let asynchronous worker work finish across session transitions. Do not check whether session changed before accepting ordinary worker results or publishing module state.
- Parse every returned worker result and apply it to current central `SessionState`; overlapping work uses last-returned-result-wins semantics.
- Keep durable module data in serialized `moduleState`; do not mirror it in module-local current-session, project, request, pending, completed, or returned fields.
- Do not create operation/god objects or callback-heavy runtime containers that bundle session getters, project getters, state emitters, update callbacks, or worker controllers. Pass central `SessionState` and explicit non-state dependencies instead.
- Do not add generic session-tagged module-state events or ordinary worker-result session guards.
- Target worker-driven modules: PR, Worktree, and Herdr tab rename. Footer, Review, and Prompt Queue are not included unless compile/test wiring requires changes.

## Superpowers documentation

Do not add AI-generated Superpowers specs or plans under `docs/` to git. Keep them local and ignored.
