# 642: Scoped SSO audit history API

1. Reuse the existing audit query parser, PostgreSQL metadata reader, whole-page projector and CSV serializer. The existing `audit:Read` action on `principal:<target>` is required even for self; never substitute usage/catalog permissions.
2. Add an explicit unactivated signed RFC 9068 service with fresh SSO binding and IAM reads on every call. Authenticate before query validation and data reads. Do not mint proxy tokens or pretend SSO actors have proxy credentials.
3. Require an awaited metadata audit port for every service outcome, including anonymous failures. Withhold all results if that port fails. Record actor, policy versions, target, request ID, outcome and count only, never JWT/query/rows/content. This port is NOT a durable-store implementation or deployment approval.
4. Add an unactivated GET `/management/v1/audit` Fetch factory with JSON/CSV, private responses and opaque existing decimal event-ID continuation. No sessions, runtime mount, browser activation, DDL or content-audit policy changes.
5. RED: missing implementation fails signed-token plus migrated embedded PostgreSQL tests. GREEN: verify real stored metadata/filter/pagination/CSV; fresh deny and revocation; authentication-before-query; malformed input; SQL failure; audit failure and pending audit; framing and no-store HTTP. Run typecheck/lint/scripts and request exact-head independent formal review and required CI before merge.

Non-goals: organization-wide audit search, SSO-event history tables, content retention, browser session decisions, installed/live provider acceptance. This API reads existing principal-scoped gateway metadata only.

## Local execution evidence (2026-11-11)

6. Continue the incomplete 17:00 implementation in an isolated 17:30 worktree based on main efae134; preserve the original uncommitted worktree. Recorded RED failed to import the not-yet-implemented service; the new SQL/Fetch suite is 10/10 GREEN. The focused audit/SSO usage regression is 90/90 with zero skipped tests. Full TypeScript check, full Biome check (existing warnings/information only), scripts/check.py, pinned schema compatibility and diff whitespace checks pass. This is not a local full npm check or installed/browser E2E result.
7. Added the public integration/activation contract and PRD reference. Dedicated durable SSO audit composition and runtime activation remain open; existing usage-audit storage must not mislabel these audit reads. Request exact-head independent review and required CI before merge.
