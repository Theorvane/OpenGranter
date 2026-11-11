# Filtered audit CSV export (#642)

1. Add an explicit user-action coordinator over the existing SSO audit CSV client. Current principal is validated caller context, never authorization.
2. Capture known filters, discard current cursor, paginate using exact server cursors. Keep one CSV header and preserve rows verbatim.
3. Default 50 / hard 100 pages and 8 MiB UTF-8. Fail without partial data on denial, failure, cancel, malformed pagination or limits. Require AbortSignal on authority/navigation changes.
4. Prove RED before source; test loopback transport and actual ephemeral SQL plus signed test JWT; verify fresh authorization, isolation, durable access audits and audit-store failure.
5. Focused tests, full typecheck, scoped lint, planning checks; stacked draft PR and exact-head formal review/CI. Frontend owns UI wiring; no session/DDL activation, installed acceptance, tamper resistance or snapshot claim.
