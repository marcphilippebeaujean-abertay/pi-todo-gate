# Agent guidance

## Control flow

Prefer `switch` when dispatching multiple mutually exclusive cases from one discriminant value. Use guard-clause `if` statements for independent validation or conditions with different predicates. Keep condition aliases readable; lint recognizes repeated equality dispatch through named boolean assignments.
