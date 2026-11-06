# Principal-scoped credential metadata inventory (#640)

1. Add a trusted internal SQL reader over existing migration002 only. It is not an authentication/authorization boundary and must not be exposed without a reviewed IAM and mandatory audit integration.
2. Require exact principal, limit1..100, explicit trusted observation time and optional typed keyset cursor. Read created-time and C-collated ID descending, fetching one extra row.
3. Project only credential/principal IDs, creation/expiry/revocation timestamps and observed lifecycle state. Never select or return token_digest, plaintext token or lifecycle actor/request metadata. Revocation takes precedence over expiry; expiry is inclusive at observation time. State is metadata, not an authentication guarantee.
4. Validate every returned row including lookahead, scope, timestamps, order and cursor bounds. Reject the whole page on corrupt/unavailable data without partial results or SQL details. No DDL, routes, session, runtime, provider or paid calls.
5. Write meaningful RED before production implementation, then GREEN unit plus actual PGlite migration002 pagination/scope/state/revoke integration. Run full typecheck/lint/planning/compatibility. Submit a draft exact-head PR; require all ancestor/exact CI and independent formal approval before merge.

## Execution evidence

- Initial missing-module probe is not behavioral evidence. RED with exported unimplemented reader: six behavioral cases fail (projection/paging, lifecycle/empty, pre-SQL validation, whole-page/cursor validation, private SQL errors and actual migrated SQL traversal). /tmp/og-0600-red-behavior.log.
- GREEN final new suite: 8 pass, 0 fail/skip, including two actual migration002/PGlite cases. Real existing token service issue -> metadata selection -> revoke -> verification denial leaves exactly issued/revoked lifecycle events; reads add none. Separate SQL traversal proves numeric creation-time and UTF8 C-order ties across pages and principal isolation. No authenticated HTTP/native-browser/installed PostgreSQL claims.
- During implementation, actual SQL caught output-alias text sorting; ORDER BY is explicitly qualified to the base bigint column. The numeric50/100 regression is retained.
- Full typecheck, repository lint, planning, compatibility and diff checks exit0. Lint still reports existing repository warnings/information; no claim of warning-free repository. No resource-heavy fullsuite duplicated; exact-head CI remains required.
- Source-only internal reader, no standing execution URL. Public inventory IAM/read-audit/API/UI and browser login remain unimplemented. Rollback: revert this source/docs/test-only commit; no data migration.
