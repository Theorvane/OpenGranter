# Usage screen composition contract

Status: candidate, disconnected screen only. No production session or schema activation.

- Module: `src/management/usage-app.ts`, `mountManagementUsage(root)`.
- Mount displays sign-in required and performs zero network requests.
- `connect(request: CatalogRequest)` invalidates the old transport and UI, resets filters, and awaits first-page loading via #699 usage client. The caller supplies an already-authorized, server-scoped request port. UI inputs are query filters, never identity grants.
- The composition owner MUST call `clear('unauthenticated' | 'expired' | 'denied')` on logout, expiry, identity or permission changes. This aborts pending reads, invalidates stale completions, clears records and filters, revokes CSV object URLs and disconnects transport. Call `dispose()` on unmount; a disposed app cannot reconnect.
- Loading, empty, ready, 400 invalid query, 401 sign-in, 403 denial, cancellation and unavailable states use fixed messages. Error bodies are not displayed.
- Filters: principal ID, model, from/to epoch milliseconds, page size. Apply resets cursor. Next page forwards the server cursor unchanged; first page removes it. No fabricated cursors or automatic all-pages export.
- Rows show epoch ms, principal, model, outcome, tokens, estimated and billed cost, usage status, possible billing and duplicate flags. Missing values are Unknown, not zero. External values use textContent only.
- Ready views offer Refresh current page: refetch the exact current query with fresh server authorization; retain successful previous-page query history, never historical rows. Loading and CSV preparation offer Cancel request: abort and invalidate the pending read, clear records/navigation/downloads, retain editable filters and show cancellation. Late responses cannot repaint or create downloads. This is client cancellation, not server transaction rollback.
- CSV fetches the current page. Download is explicit via a `usage.csv` blob link, not a total export. The link is revoked on another read, identity clear or disposal.
- Dependencies still unresolved: authorized session/transport owner, mounted HTTP composition and actual authenticated browser E2E. This contract does not replace the catalog list/detail contract or approve those dependencies.

Validation: `test/management-usage-app.test.ts` uses structural DOM plus a real loopback HTTP handler with a fake service. This is not a production JWT/session proof. Isolated visual browser smoke is a separate check.

## Trusted deadline integration (#642)

`authorize(grant: CatalogAuthorityGrant)` is the session-adapter integration path on the existing mounted screen. The trusted owner supplies the same request port and absolute safe-integer future epoch-ms deadline used by the catalog; UI filters never confer authority. This does not authenticate a session or mint a token. Low-level `connect(request)` remains compatible and requires externally owned lifecycle clearing.

The screen automatically clears transport, rows, filters, page history and CSV links on expiry. Every list/refresh/page/filter/CSV read checks the deadline before network dispatch and after body consumption, so suspended timers cannot publish a late result. Pending work is aborted on timer expiry. A fully consumed response is withheld, not retrospectively aborted or rolled back. Invalid replacement grants erase the previous state without network work. Renewal cancels old timers and stale completions; long deadlines use bounded timers that rearm. 401/403 disconnect transport and cancel the deadline. Logout and permission-change owners must still call clear; dispose remains terminal.

Validation includes the actual mounted app through signed RFC9068 loopback HTTP, embedded PostgreSQL-compatible storage, fresh IAM and mandatory durable audit using an explicitly loaded candidate schema. Structural DOM is not native-browser, installed-schema, IdP-login or provider acceptance. Entry owner wiring and installed listener/schema decisions remain outstanding.

## Shared model / usage workspace (#642)

An explicit trusted owner may mount mountSsoUsageWorkspace(root, lifecycle, options) and pass its approved CatalogAuthorityGrant. Native Models / Usage history navigation mounts the existing SSO catalog or usage app, disposes the previous view and performs a fresh read through the same trusted port. No proxy fallback, cross-view cache, global grant endpoint or credential acquisition is added. Logout, pagehide, expiry and current-grant HTTP 401/403 clear both retained authority and displayed data; stale responses cannot clear renewed grants. Completed CSV URLs are revoked on navigation and pending exports are aborted on pagehide. pageshow never replays a grant.

The public sign-in entry is NOT changed or activated. Session/BFF, installed usage listener/schema and entry-owner wiring remain separate held dependencies. Isolated signed HTTP / embedded SQL / structural DOM evidence is not native-browser or installed SSO acceptance.
