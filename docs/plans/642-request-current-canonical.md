# Integrate exact usage request tracing on the current canonical runtime

1. Reuse #880 request-ID contracts and tests on main after #890. Preserve its old head for dependent PR navigation; do not activate session or deployment.
2. RED: execute the real signed-SSO canonical Fetch composition with migrated SQL, exact request filtering, pagination, cost comparisons and JSON/CSV. Verify unknown/bad/foreign request behavior and mandatory audit withholding.
3. Port the existing parser, SQL scoped snapshot and SSO/proxy propagation onto current main without losing cost comparison projections. No IAM, DDL, cookie, paid budget or listener defaults change.
4. Run focused and type/lint/planning gates; record resource failures separately. Retarget #880 to main with its exact new head; require fresh CI and independent formal approval before merge.
5. Only after parent merge rebase #882/#883 without dropping request filtering or cost projection. Native login remains blocked on approved session/IdP contracts.
