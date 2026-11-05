# Bounded SSO catalog detail (#641)

1. Parent #637 requires actual catalog list/detail API integration. Detail currently scans the bounded full collection, so unrelated invalid records or more than 1,000 models make an otherwise valid authorized detail unavailable.
2. Add a parameterized exact-alias publication lookup to the existing PostgreSQL reader, with at most two rows to detect duplicate/corrupt results. Preserve the same row validation and missing/disabled semantics; keep the list limit unchanged.
3. Use that lookup only for SSO detail. Fresh JWT/binding/IAM evaluation and mandatory awaited audit remain unchanged. Do not expose hidden model existence, routes, secrets or upstream data. No cookie/session, runtime, DDL, permission, paid-call or deployment change.
4. RED: a migrated database with over 1,000 unrelated publications must still yield the authorized detail while list fails closed; a malformed unrelated route must not poison detail. Verify absent, disabled, denied, fresh-policy and audit-failure outcomes.
5. GREEN: run reader, SSO service, HTTP and runtime regression suites plus typecheck, lint, planning and compatibility checks. Local PGlite/JWT is not installed PostgreSQL, browser/IdP or live-provider evidence.
6. Submit an exact-head PR, require independent formal approval and all required CI before merge. Rollback this isolated lookup/service change if rejected.
