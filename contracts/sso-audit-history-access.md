# SSO audit-history access SQL writer

createPostgresSsoAuditHistoryAccessStore(client, now).append implements the explicit trusted writeAuditHistoryAccess port on the administration browser/workspace API. It stores access metadata in the separate candidate sso_audit_history_access_events table. It is NOT a gateway audit event, proxy credential, history reader or content-retention feature.

## Invariants

- Allowlist request ID, local millisecond timestamp, nullable actor/policy versions, nullable target principal, outcome and count. Unknown fields, tokens, raw query, returned rows, SQL diagnostics and proxy credentials are never serialized.
- Identifiers are nonempty strings, at most 256 UTF-16 code units, without ASCII controls. Policy versions are an array of at most 1024 valid ID/version pairs. Values are copied synchronously before the first asynchronous boundary.
- Outcomes: ready, forbidden, invalid_query, unauthenticated, unavailable. Counts are safe integers 0..100; non-ready counts are zero. ready/forbidden require authenticated actor and target. invalid_query has authenticated actor but no target. Anonymous unauthenticated/unavailable has no actor/versions/target. Authenticated unavailable may have a target or none.
- INSERT must return exactly one positive decimal text event_id. SQL/clock/ack failures become fixed SsoAuditHistoryAccessUnavailable; malformed metadata becomes InvalidSsoAuditHistoryAccessEvent before SQL. Existing service catches writer rejection and withholds JSON/CSV with audit_unavailable.

## Deployment gates

The SQL contract is a review candidate, outside the active numbered migration manifest. No schema or store approval is implied. No startup/service/bootstrap/UI/session/ingress change or default activation is included. Installed activation requires independent schema/ownership review, migration/recovery evidence and an approved writer whose promise resolves after committed storage. This module sees INSERT acknowledgement, not transaction commit: do not wire a caller-owned uncommitted transaction to a response-releasing writer. Local PGlite does not prove installed PostgreSQL durability, company SSO or native browser acceptance.

## Verification

New tests exercise a real loopback Node HTTP administration server, signed RFC9068 JWT, fresh SQL IAM and gateway metadata, concrete SQL access persistence, scoped JSON/CSV, empty/denied/invalid/anonymous/storage failures, failed sink withholding, validation/ACK/clock errors and snapshot/await behavior. Test schema is installed explicitly only in isolated PGlite. Default manifest absence is asserted. No paid provider calls.
