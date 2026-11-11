# Audit browser projection closure (#642)

1. Keep the existing authorized audit JSON/page CSV contracts and exact request filter; add no endpoints, grants, session or UI activation.
2. RED: compile both production clients and reject any runtime PostgreSQL source in the publication closure.
3. Extract the existing event projection unchanged into a pure module, preserving server exports and error identity. Point public HTTP projection at that module.
4. GREEN: execute the compiled JSON and CSV clients, prove request filter propagation and fail-closed foreign-row behavior; run SQL/audit regressions and typecheck.
5. Update existing PR852 only; require exact-head CI and formal approval before merge. Browser-safe dependency evidence is not real login or deployment acceptance.
