# Authorized browser audit CSV page (#642)

`createSsoAuditExportClient(CatalogRequest).read(AuditFilters)` uses the existing `/management/v1/audit?format=csv` endpoint through an already-authorized request port. It returns `ready {csv, hasMore, nextCursor}` or safe `invalid_query`, `unauthenticated`, `denied`, `unavailable`, `cancelled` states. `invalidate()` suppresses stale results. No credential storage, DOM or automatic download.

Preserve existing principal/request/model/time/limit filters, no-store GET and redirect rejection. The server is the permission and CSV redaction/formula-safety authority. Validate text/csv UTF-8, x-has-more and exact positive PostgreSQL bigint continuation headers; require strictly descending continuation against the exact captured request cursor, never convert to Number. No cursor when terminal. Bound decoded body to 2 MiB and 15 seconds, validate identity Content-Length, fail on malformed UTF-8. Preserve server CSV text, including header-only empty exports; no client-side reconstruction or JSON-to-CSV permission shortcut. UI retains the same filters when following opaque cursor, drops old data on identity change and downloads only after ready.

Reuse the audit JSON transport lifecycle and pure query validation. Canonical builder integration outside src/management is still a separately reviewed frontend-owner prerequisite; these tests certify no rendered UI, browser session or deployment.


## Compressed download framing (#642)

Usage and audit CSV clients enforce the 2 MiB cap on Fetch-decoded bytes. Compressed wire Content-Length is not a decoded size limit; an uncompressed page exactly at the cap remains downloadable even when gzip framing makes its wire body larger. Identity responses reject overflow on the first excess chunk, cancel the producer and return unavailable without waiting for EOF or exposing partial data. Exact EOF length, strict UTF-8, deadlines, pagination and authorization remain unchanged. See [plan](../docs/plans/642-history-compressed-download.md).
