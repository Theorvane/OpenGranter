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
