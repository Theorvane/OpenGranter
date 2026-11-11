# Audit request trace (#642)

1. Scope: correlate existing principal-scoped gateway audit metadata by exact request ID on proxy and SSO JSON/CSV; no new session, runtime activation, DDL or content retention.
2. Contract: optional request_id is case-sensitive ASCII 1..256 with the existing management identifier alphabet. Reject duplicate/empty/malformed values; intersect principal/model/time/keyset predicates. Fresh audit:Read, explicit Deny and mandatory access audit stay authoritative.
3. RED: exercise parser, actual migrated SQL, proxy and signed SSO boundaries before source changes; show missing filter behavior, not tool failures.
4. Implement bound SQL and revalidation of every row including lookahead. Snapshot all reader scope/filter/page values before asynchronous I/O.
5. GREEN: test exact matches, empty pages, pagination, foreign principals with same ID, malformed and duplicated parameters, forged reader rows and mutation during SQL. Run existing audit/proxy/SSO regressions, typecheck, lint and planning checks.
6. Submit independent PR against main; require exact-head formal approval and required CI before merge. Native-browser, installed PostgreSQL, company IdP and production acceptance remain separate.
