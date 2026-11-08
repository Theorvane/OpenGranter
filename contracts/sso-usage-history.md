# Internal SSO usage history

createPostgresSsoUsageHistory accepts trusted RFC9068 configuration, SQL client and mandatory SSO metadata audit writer. read(accessToken, requestId, query) accepts URL search text with optional leading question mark, not browser identity claims. It authenticates current human binding/IAM before parsing, authorizes existing usage:ReadSelf/ReadAll and reads PostgreSQL usage scoped to target principal. Explicit principal selection always requires ReadAll, including oneself.

Strict existing usage query rules apply: principal_id, model, from_ms inclusive, to_ms exclusive, limit 1..100, opaque cursor, json/csv format; duplicate/unknown fields fail. Success returns format, allowlisted data or CSV, hasMore and nextCursor. Unknown/cost/duplicate fields are copied without billing inference. Empty is success. Deny/errors expose no records. Every outcome awaits SSO-specific nonsecret audit; audit failure replaces result with audit_unavailable. Never fabricate proxy credentialId. Fresh auth/IAM are not an atomic revocation guarantee.

Internal service only, NOT public route, session or installed acceptance. Integration MUST supply reviewed durable SSO writer; no default writer, DDL, cookie, login, provider invocation or activation. Proxy usage paths unchanged. Future HTTP must supply trusted request IDs and fixed errors, never client identity/IAM/audit callbacks.

Plan: [implementation](../docs/plans/642-sso-usage-history.md). Test: test/postgres-sso-usage-history.test.ts. Parent #637 / #642.
