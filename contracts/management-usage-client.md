# Browser usage JSON client

`createSsoUsageClient(request)` accepts an already-authorized `CatalogRequest`. `read({principalId?,model?,fromMs?,toMs?,limit?,cursor?})` reads one fixed same-origin `/management/v1/usage?format=json` page; `invalidate()` cancels pending results. No tokens, session, DOM, persistent cache, listener or runtime activation. The UI must invalidate and drop prior data on identity change and supply fresh authorization through its reviewed port. Never infer caller identity from a principal filter: explicit principal still requires server ReadAll.

Ready: `{state:'ready',data,hasMore,nextCursor}`. Rows use existing `UsageRecord` allowlist and preserve missing/partial/invalid usage, decimal money with source/version and null billed cost, possiblyBilled and possibleDuplicate without inference. Empty data is ready. Unknown extra fields are dropped recursively by the existing row parser; malformed rows or pages withhold the entire page. Requested principal/model/time constraints, page limit, descending timestamp/UTF-8 attempt order, unique attempts and exact last-row continuation are checked. Cursors remain opaque and must be reused with identical filters. This client check does not replace server authorization.

Failures are status-only invalid_query/unauthenticated/denied/unavailable/cancelled; no private error body or thrown cause is returned. GET uses no-store, redirect:error and application/json. Require HTTP200 and JSON UTF-8 media type, valid list/boolean/continuation envelope, at most 2MiB streamed UTF-8 and 15 seconds. Stale responses are withheld even if the request ignores abort. Error/unread bodies are cancelled without waiting for stream cleanup. New read supersedes old read, even when new filters are invalid.

Integration evidence: signed JWT, migrated embedded PGlite, actual Fetch adapter and durable SQL SSO usage audit; fresh inactive identity denies and missing durable audit table withholds otherwise authorized data. This is not a browser session, real IdP, installed PostgreSQL, deployed UI or provider-call acceptance.

Plan: [implementation](../docs/plans/642-browser-usage-history.md). Tests: test/management-usage-client.test.ts. Parent #637 / #642. CSV transport remains separate and unchanged.

Response integrity: at EOF, require identity-encoded observed UTF-8 byte length to equal a supplied Content-Length, including zero. Missing lengths use streaming limits only. Compressed Fetch responses expose decoded bytes; do not compare them to compressed wire length. Continue to bound decoded bytes and time and withhold the whole page on mismatch.

Pending-request scope: capture the six allowlisted scalar filters once before building the query, and validate responses against that exact snapshot. Caller mutation or accessor changes while network/body reads are pending cannot relax principal/model/time/page-size/continuation checks or invalidate a page matching the originally requested scope. Accessor failures return invalid_query without a request. This is client response integrity, not an authorization substitute.

## Validated cost comparison (#642)

Ready rows are additive `UsageJsonRecord` values, including `costComparison` recomputed with the same exact decimal algorithm as the authorized JSON API and CSV. Do not trust a supplied comparison, even when plausible. Older responses without that field remain supported. Same-currency comparable amounts expose a canonical signed decimal string and currency; unknown, one-source and mismatched-currency states have null delta/currency. Preserve original source/version/amounts, unknown token usage and independent duplicate/possibly-billed flags. Equal amounts are not invoice reconciliation. No floating point conversion or CSV apostrophe is applied to JSON. This transport projection does not render a screen or create a session.

Plan: [browser comparison](../docs/plans/642-browser-cost-comparison.md).
