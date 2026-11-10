# SSO gateway audit history

`createPostgresSsoAuditHistory` and `createSsoAuditHistoryHandler`/`Server` provide opt-in Bearer-only `GET /management/v1/audit` metadata history. They do not mount on existing listeners or enable cookies, sessions, content retention or migrations.

- Registered-key RFC9068 SSO human authentication and fresh binding/IAM precede query parsing. Both implicit self and explicit targets require `audit:Read` on `principal:<target>`; usage permissions never substitute. Explicit Deny wins.
- Existing audit query grammar applies: principal_id, model, from_ms inclusive, to_ms exclusive, limit 1–100, decimal event-ID cursor and format json/csv. Unknown/duplicate fields fail. Only existing gateway events are returned; SSO-management audit history remains separate, not fabricated into proxy events.
- JSON: `{object:'list',data:[...projected gateway metadata],next_cursor:string|null}`. CSV is an attachment `audit.csv`, with existing allowlisted columns and spreadsheet formula neutralization. Both have `x-audit-has-more`, optional exact `x-audit-next-cursor`, `x-request-id`, no-store and nosniff. Advance only using the returned cursor.
- 401 unauthenticated, 403 forbidden, 400 invalid query, 503 unavailable or audit_unavailable. Private SQL/auth/audit diagnostics are never exposed. Routing/transport rejection before service execution follows the existing HTTP boundary and does not promise a durable service access event.
- Every service read requires an awaited injected SSO-specific access-audit writer before returning results, including denial, malformed query and storage failures. Metadata includes actor (nullable), target (nullable), policy versions, request ID, outcome and count. No actor proxy credential is invented. The writer is trusted; deployments must supply an approved durable implementation. Tests use an in-memory sink to prove await/failure behavior, NOT durable installation.
- No approved durable schema, session/BFF integration, installed PostgreSQL, native browser or live provider certification is implied. Existing gateway audit rows and their credential attribution remain unchanged. Fresh binding/IAM reads do not create atomic revocation guarantees.

## Exact request correlation (#641)

Optional `request_id` selects the projected event request ID, never arbitrary details. One value, 1..256 characters, `[A-Za-z0-9][A-Za-z0-9._+:/@-]*`; matching is case-sensitive (encode plus as `%2B`). Empty/duplicate/invalid values fail the existing invalid-query path after authentication. Principal scope, `audit:Read`, fresh IAM and mandatory audit are unchanged. Combine with model/time/cursor filters for JSON or CSV; every continuation request must retain its filters. SQL binds the ID as a value and validates the entire result including lookahead. Query values are not added to access audit records. No session, UI, runtime or deployment grant.


## Reader-owned request scope (#642)

The production SQL reader captures the scalar principal, filters, page limit and opaque cursor before validation or awaiting SQL. The same owned values drive parameter binding, full returned-row validation including lookahead, page slicing and next-cursor selection. Caller mutation while SQL is pending cannot widen a request or legitimize substituted foreign-principal/filter rows. This is internal asynchronous ownership, not a claim that browsers can mutate server-side query objects. Fresh IAM and mandatory access audit remain unchanged.
