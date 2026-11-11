# SSO audit metadata history (#642)

`createPostgresSsoAuditHistory` and `createSsoAuditHistoryHandler` provide an explicit, unactivated signed-bearer API for existing gateway audit metadata. They neither start a listener nor mount a route in production.

## Authorization and query

- GET `/management/v1/audit`. Verify registered RFC 9068 signature, issuer, audience, lifetime and current SSO binding, active human principal and current IAM attachments on every request before parsing the query or reading history.
- Require `audit:Read` on `principal:<target>` for every read, including self. Absent `principal_id` targets the authenticated human; an explicit target never bypasses evaluation. Usage and catalog permissions do not substitute for audit permission. Explicit Deny prevails.
- Reuse the existing strict audit query: optional `principal_id`, `model`, `from_ms`, `to_ms`, `limit` (1–100, default 50), `cursor` and `format` (`json` default or `csv`). Unknown/duplicate parameters, invalid ranges and malformed cursors fail closed. Decimal event IDs are opaque continuation strings, not client-computed offsets.
- Read only `gateway_audit_events` scoped to the authorized target. Reproject the complete page, filters and continuation before publication. A corrupt row fails the page rather than becoming an empty success. No content retention or organization-wide search is introduced.

## Responses

JSON preserves the existing event projection in `{object:"list",data,has_more,next_cursor}`. CSV uses the existing injection-safe serializer, `text/csv; charset=utf-8`, filename `audit.csv`, `x-has-more` and optional `x-next-cursor`. Historical proxy credential IDs remain original historical event metadata, not credentials fabricated for the SSO reader.

Every response is `no-store` and `nosniff`. Authentication failures are 401 with a Bearer challenge, denied reads 403, malformed query/framing 400, unknown path 404, data/identity infrastructure failure 503 `audit_history_unavailable`, and mandatory access-audit failure 503 `audit_unavailable`. Errors never expose SQL, JWTs or internal exception messages.

## Mandatory access audit and activation gate

The service requires an awaited `writeAudit` port. Before any service result is returned, record request ID, current actor/policy versions (or null for anonymous), authorized target, outcome and returned count. Never pass JWTs, query strings, model filters, stored event rows, CSV or content to this port. Audit append failure withholds successful JSON/CSV and all service errors alike. Routing/framing rejection happens before the service and does not call this port.

The injected writer is a contract, **not** a durable store implementation. Deployment must compose an approved dedicated durable SSO audit writer; it must not label these reads as usage events or synthetic proxy events. This change adds no migration, runtime mount, cookie, browser session, CORS, CSRF or IdP decision. Fresh reads do not guarantee atomic revocation mid-request. Browser, installed PostgreSQL and live-provider acceptance remain separate gates.

## Evidence

`test/postgres-sso-audit-history.test.ts` uses signed test JWTs and migrated embedded PostgreSQL (PGlite), actual stored gateway events and the Fetch handler. It covers JSON/CSV, filters, keyset pagination, empty pages, cross-principal scopes, current policy changes and deactivation, explicit Deny, malformed/expired credentials, invalid queries, corrupt rows, SQL failure, failed/pending access audit and HTTP framing/privacy. This is local SQL/Fetch evidence, not native browser or installed E2E certification.
