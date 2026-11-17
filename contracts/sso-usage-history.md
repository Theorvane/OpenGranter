# Internal SSO usage history

createPostgresSsoUsageHistory accepts trusted RFC9068 configuration, SQL client and mandatory SSO metadata audit writer. read(accessToken, requestId, query) accepts URL search text with optional leading question mark, not browser identity claims. It authenticates current human binding/IAM before parsing, authorizes existing usage:ReadSelf/ReadAll and reads PostgreSQL usage scoped to target principal. Explicit principal selection always requires ReadAll, including oneself.

Strict existing usage query rules apply: principal_id, model, from_ms inclusive, to_ms exclusive, limit 1..100, opaque cursor, json/csv format; duplicate/unknown fields fail. Success returns format, allowlisted data or CSV, hasMore and nextCursor. Unknown/cost/duplicate fields are copied without billing inference. Empty is success. Deny/errors expose no records. Every outcome awaits SSO-specific nonsecret audit; audit failure replaces result with audit_unavailable. Never fabricate proxy credentialId. Fresh auth/IAM are not an atomic revocation guarantee.

Internal service only, NOT public route, session or installed acceptance. Integration MUST supply reviewed durable SSO writer; no default writer, DDL, cookie, login, provider invocation or activation. Proxy usage paths unchanged. Future HTTP must supply trusted request IDs and fixed errors, never client identity/IAM/audit callbacks.

Plan: [implementation](../docs/plans/642-sso-usage-history.md). Test: test/postgres-sso-usage-history.test.ts. Parent #637 / #642.

Continuations must pass the existing cursor parser after encoding, including the 2048-character encoded and 512-character decoded ID bounds. An unconsumable continuation fails the entire JSON/CSV page as unavailable and audits zero records; it must not expose partial data or pretend the page is final. A final page needs no continuation.

## Unactivated Fetch adapter

`createSsoUsageHistoryHandler` accepts the trusted existing service and a server request-ID generator. It exposes GET /management/v1/usage; it does not mount a route, create a listener, acquire a token, issue cookies or change the pending session/BFF contract. It passes only the Bearer access token, request ID and URL query to the service. Existing usage:ReadSelf/ReadAll, query grammar, continuation and mandatory SSO audit remain unchanged.

Ready JSON is `{ object: 'list', data, has_more, next_cursor }`. CSV uses text/csv, attachment filename usage.csv, x-has-more and optional x-next-cursor. Unknown usage, absent cost and the existing allowlisted metadata are preserved without repricing. Authentication failure maps to 401 with Bearer challenge, invalid_query to 400, forbidden to 403, unavailable to usage_unavailable/503 and failed audit to audit_unavailable/503. All responses are no-store and nosniff. Fixed exception errors contain no private causes. Missing routes return 404; unsupported methods, bodies and pre-aborted requests return 400 without reaching service audit. An aborted request never releases a page.

Durable SSO usage audit storage/composition and runtime mount are still required before deployment. Local signed JWT/migrated PGlite/Fetch evidence does not prove real IdP, browser/session or installed PostgreSQL acceptance. See [HTTP plan](../docs/plans/642-sso-usage-history-http.md).


## Explicit durable SSO usage HTTP composition (#642)

`createPostgresSsoUsageHistoryHandler` composes the existing signed-bearer Fetch usage handler with fresh SSO/IAM reads and mandatory awaited PostgreSQL metadata audit. Migration 013 adds dedicated `sso_usage_audit_events` without rewriting historical usage or fabricating proxy credentials. Persist server request ID, actor, policy versions, target principal, self/all mode, outcome and returned row count only. Never store bearer credentials, query strings, model filters, CSV/usage rows or content in this metadata table. JSON/CSV and anonymous/denied/error responses are withheld with HTTP 503 if the audit insert or acknowledgement fails. Additional callback properties cannot replace the durable writer. Existing query, authorization and no-store response contracts remain unchanged.

Acceptance: signed SSO JSON/CSV and empty pages persist attribution; malformed query and fresh Deny persist zero-count outcomes; no response completes while its insert is pending; failed insert withholds results. Additive migration preserves previous checksums and data and is idempotent under the existing runner. The factory is unactivated; database migration/lifecycle, runtime mount, browser sessions, retention/readers and installed PostgreSQL/IdP/provider E2E remain separate gates. See [plan](../docs/plans/642-durable-sso-usage-http.md).
