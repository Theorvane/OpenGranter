# Browser audit JSON transport (#642)

`createSsoAuditClient(request)` uses an already-authorized `CatalogRequest` to read one `/management/v1/audit?format=json` page. `read({principalId?,requestId?,model?,fromMs?,toMs?,limit?,cursor?})` and `invalidate()` mirror existing usage transport lifecycle. No credential handling, DOM, cache, session, new permission or listener. Server authentication, audit:Read and mandatory durable audit remain authoritative.

Ready returns allowlisted metadata `data`, `hasMore` and verbatim `nextCursor`. Empty is ready. Existing audit query and event projection enforce filters, exact descending positive PostgreSQL bigint event IDs, single-principal page scope and last-event continuation. An omitted principal is not an identity assertion; the server resolves it. Private extra fields are dropped recursively. Malformed or out-of-scope pages withhold all rows. Cursor reuse requires unchanged filters.

GET uses no-store, redirect:error and application/json. Require status 200 and UTF-8 JSON, maximum 2 MiB decoded bytes, exact uncompressed Content-Length when supplied and 15-second deadline. New reads (even invalid ones) and invalidation supersede old reads. Cancellation settles even for an uncooperative request/body. Non-success bodies are cancelled unread. Only invalid_query, unauthenticated, denied, unavailable and cancelled states escape; no private causes or body text.

Tests distinguish injected responses and signed-SSO migrated embedded database/Fetch acceptance from native browser, real IdP, installed PostgreSQL, UI rendering, deployment and provider acceptance. No content retention decision is made.

Plan: [implementation](../docs/plans/642-browser-audit-history.md).
