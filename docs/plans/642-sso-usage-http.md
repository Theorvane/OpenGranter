# SSO usage HTTP boundary (#642)

1. Scope: implement explicit Bearer-only GET /management/v1/usage on an unbound Node server using the existing fresh-authenticated usage reader and mandatory concrete durable audit. Preserve existing query parsing, self/all isolation and cost semantics. No browser session, automatic mount, DDL activation, provider calls or deployment.
2. Contract first: JSON list with has_more/next_cursor, CSV download with fixed filename and paging headers; fixed 400/401/403/503 errors, no-store/nosniff, trusted request IDs. Malformed bearer reaches the reader for denial audit. Reject framed GET bodies and aborted requests. Never use cookies as credentials.
3. RED: execute the new HTTP test before adding production modules; missing module is the expected initial failure.
4. GREEN: loopback HTTP with real signed RFC9068 token, migrated ephemeral PGlite plus explicitly candidate schema; nonempty/empty, filters/cursor, CSV, fresh denial/deactivation, expired and absent token, invalid query, audit failure. Handler guards and sanitized errors tested separately.
5. Run typecheck, changed-file lint, planning checks and full check; create dependent draft PR against #697. Require exact-head CI and independent formal approval before merge. Candidate schema and session/mount integration remain blocked on their respective approvals.
