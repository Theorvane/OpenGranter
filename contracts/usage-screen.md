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


## Explicit CSV page continuation (#642)

The existing usage screen offers Export next CSV page only after a successful CSV page returns a next cursor. Carry that exact opaque cursor and applied filters in a fresh protected request; never infer it from JSON pagination or auto-aggregate exports. Each download is one page. Export current page CSV restarts from the visible JSON page without mutating its navigation history. Revoke the previous download before a subsequent export; invalidate continuation on list/filter changes, cancellation, expiry, clear, denial and disposal. Detached controls and late responses cannot restore an invalidated chain. This source/local HTTP change does not activate a listener, migration, public entry or session. See [plan](../docs/plans/642-csv-page-continuation.md).

## Explicit review API composition (#642)

The opt-in server-only review handler shares trusted registered-key and SQL configuration across existing catalog and usage handlers without caching identity. Exact GET catalog list/detail and usage JSON/CSV retain original requests and mandatory durable audits. Unknown paths and writes fail closed before SQL. This does not mount a listener or promote candidate schema.

## UTC review controls (#642)

Time filters use explicitly UTC datetime controls with millisecond precision and an exclusive upper bound. Calendar validation rejects impossible dates, pre-epoch input and timezone suffixes before any HTTP request. The existing from_ms/to_ms query and CSV contracts are unchanged; record times display ISO UTC with an epoch fallback outside the supported Date range. Local browser timezone must never shift the selected range. No session or runtime activation.

## Current model inspection from usage (#642)

Within the explicitly mounted trusted workspace, each usage model has a native Inspect model button that disposes the usage view and its downloads and opens current catalog detail through the same fresh SSO/IAM audited transport. The historical alias is only a lookup key, not permission, a route or cached catalog metadata. Revoked or unavailable model access remains hidden as not-found; auth failures still clear workspace authority. Back to models performs a fresh list. Standalone usage mounts have no navigation unless their trusted owner opts in. Detached controls cannot navigate after reload, grant renewal, expiry, clear or disposal. No public entry, session, listener or schema activation is added.

Workspace navigation controls belong only to their creating render. Detached Models/Usage history controls after a view change, renewal, clear, pagehide/restoration or disposal cannot dispatch with current authority or replace the active view. Current controls remain functional; server authorization and mandatory audits are unchanged.

## Usage action render lifetime (#642)

Every usage button belongs to its creating render, including Apply filters, paging, retry, refresh, CSV continuation and cancellation. A detached button after rerender, renewal, clear or disposal must not dispatch with the current authority or interrupt a replacement request. Current controls still check expiry before acting. Native download links retain the existing object-URL revocation rules. See [plan](../docs/plans/642-usage-control-lifetime.md).

## CSV link activation lifetime (#642)

A CSV download anchor rechecks click, auxiliary-click and context-menu events and permits its native default action only for its creating render, current object URL and live trusted deadline. Suspended expiry timers cannot extend download activation. Replacement, renewal, clear and disposal block detached anchors; current unexpired downloads still work. This does not revoke bytes already downloaded or establish native-browser/installed acceptance. See [plan](../docs/plans/642-csv-download-authority.md).
