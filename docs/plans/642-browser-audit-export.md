# Browser audit CSV transport (#642)

1. Reuse existing authorized signed-SSO audit CSV endpoint and query validation. Add no identity, session, authority, listener or retention configuration.
2. Write meaningful failing public-client tests for CSV filter serialization, exact bigint continuation, invalid pagination, bounded UTF-8 and cancellation.
3. Share the existing audit request lifecycle without duplicating schemas; expose an additive CSV client. Preserve JSON API and server-produced CSV bytes; do not parse or reconstruct CSV records.
4. Exercise actual signed-SSO Fetch over migrated PGlite, mandatory durable access audit, redaction, pagination, filtered empty export and denial before history SQL.
5. Run focused regression, full TypeScript and static checks. Request exact-head independent review and CI before merge. Native browser rendering, canonical shared-module build integration, IdP and installed deployment remain separate gates.

## Acceptance and recovery

Fail closed on invalid queries, media types, pagination, nonprogressing or out-of-range cursors, oversized/malformed/truncated UTF-8 bodies and mandatory access-audit failure. Invalidation and deadlines settle even for uncooperative request/body cancellation. Filter values are captured once. Return only the current page, never aggregate all history or download automatically. Recovery is reverting this additive client; no migration or activation.
