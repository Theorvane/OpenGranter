# History request ID boundary (#642)

1. Reuse the Models/Account server-generated request ID grammar: string, 1–256 ASCII characters, first alphanumeric and remaining alphanumeric or ._+:/@-. Validate before assigning the response/audit ID. No new ID format, session or IAM contract.
2. RED: demonstrate invalid IDs reach history.read or cause unsafe error handling in Usage and Audit. Test both Fetch and actual loopback Node HTTP adapters; invalid IDs must produce fixed 503 internal_error without ID reflection or service invocation.
3. GREEN: reject invalid generated IDs before SQL/authentication/audit access; retain no-store/nosniff and preserve ordinary signed-bearer JSON/CSV authorization and mandatory durable audit regressions. Test durable compositions with SQL spies too.
4. Verify types, lint, documentation and exact-head CI; require independent formal approval before ordered merge. No runtime activation, DDL, session, IdP, installed PostgreSQL, deployment or paid/provider claims.
