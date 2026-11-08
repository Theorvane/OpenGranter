# Unified read-only review Node server (#642)

1. Reuse the composed registered-key SSO catalog/usage handler and existing Node Request bridge in an explicit unbound server factory. Do not activate a listener, session, runtime or schema. Caller owns TLS, SQL lifecycle and reviewed schema promotion.
2. Preserve exact route dispatch, query, framing rejection, cancellation and safe no-store/nosniff failures. Do not compose token writes or infer browser authority.
3. Demonstrate missing factory in RED, implement it, and test actual loopback routes and framed GET rejection before SQL. Switch the existing signed-SSO workspace integration from test-only server composition to this production factory; retain list/detail/usage/CSV/IAM/mandatory audit checks.
4. Run focused tests, typecheck, lint and planning checks; obtain exact-head CI and formal independent approval before merge. Local embedded SQL and structural DOM tests do not certify installed PostgreSQL, browser login or provider acceptance.
