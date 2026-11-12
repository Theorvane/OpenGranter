# Usage and audit DOM adapters

`src/management/review-app.ts` exports `mountSsoUsageReview(root, trustedRequest, onCsv?)` and `mountSsoAuditReview(root, trustedRequest, onCsv?)`.

The host supplies the same trusted signed-SSO request port as the existing coordinators. Mounting does not fetch or authenticate. Call `load(filters)` explicitly; the model filter button issues a new load and resets pagination. Previous/next/retry controls use coordinator state. Safe idle/loading/empty/error/access-denied states and accessible labelled tables are rendered with textContent, never HTML. Usage decimals remain strings and missing costs display Unknown. CSV is requested only by an explicit button (when the optional host callback exists) or exported method, with current-page filters. The callback receives validated CSV for host-controlled download; no download or credential source is installed.

The returned handle exposes snapshot/load/next/previous/retry/exportCsv/dispose. The trusted host MUST dispose the old adapter before an identity or expiry transition, and mount a fresh adapter for the next identity. Disposal clears DOM and invalidates in-flight requests. No public entry is activated, no grants are constructed, and no browser/global storage is used.

The canonical builder permits these exact shared runtime sources, applying the same resolver recursively to every import:

- usage/json.ts, usage/stored-record.ts, usage/record-usage.ts, usage/cost-comparison.ts
- audit/attribution.ts, audit/history-http.ts, audit/history-filters.ts, audit/time-range.ts, audit/gateway-event.ts

All paths above are relative to src/. No entire shared directory is allowed. Shared symlink aliases, external packages, Node builtins, usage/history.ts (Buffer cursor helpers), and PostgreSQL adapters remain excluded. Stored-record validation and audit projection are extracted unchanged; old server import paths re-export the same symbols/classes for compatibility.

This is a DOM/library integration, not deployment activation. A reviewed runtime URL and trusted browser session/request supplier are still required for real login-to-API browser acceptance. Unit tests and signed-SSO/PGlite regression tests do not establish that deployed browser acceptance.
