# History management DOM contract (#642)

The opt-in mountHistoryWorkspace(root, trustedSsoRequest, downloadLease) connects existing scoped usage/audit clients to native controls. It is not an authenticator. The caller must dispose on known logout, expiry and identity change; the injected download lease belongs exclusively to this mount. The public browser entry is not activated.

- Usage loads initially; Audit loads lazily when selected. Each tab has independent principal/model/time filters; audit additionally offers request ID. From/to are explicit Unix milliseconds, inclusive/exclusive. Invalid or inverted ranges cannot reach the transport. Searches reset cursors; next/previous use existing client cursor validation.
- Loading and empty views contain no prior rows. Unavailable reads offer retry; invalid filters remain editable. Native disabled paging/export buttons cannot send requests; retained handlers from replaced views cannot act.
- Usage displays exact estimated/reported decimal strings separately, price version/source, unknown token/cost data, comparison metadata, possible duplicate and possibly billed markers. No float conversion or fabricated invoice reconciliation. Audit renders only timestamp/kind/principal/request metadata, never arbitrary details or prompt/response content. All external values use textContent.
- CSV explicitly exports only the currently loaded page/filter/cursor via existing authorized boundaries; no automatic traversal. The trusted download adapter can be createCsvDownload. Export failures display generic diagnostics. Started downloads cannot be erased on logout.
- Fresh 401/403 in either history clears both tabs and releases download leases once. Dispose clears the DOM, invalidates retained controls, cancels pending work and releases leases once. Late exports after denial/disposal cannot save bytes. No credential storage, session acquisition, new IAM/audit policy, runtime activation or installed acceptance is implied.

Evidence: test/management-history-app.test.ts and existing shared workspace/client suites. Native browser preview uses synthetic responses and is not company SSO, installed PostgreSQL or live-provider acceptance.

## History CSV delivery failures (#642)
The history DOM mount preserves the CsvDownloadResult port contract: only `started` means browser delivery initiation, not completed file persistence. Returned `unavailable`, `invalid`, `disposed`, and thrown adapter errors show a generic retryable CSV alert in the originating tab. Explicit retry clears that delivery alert; other tabs do not inherit it. Raw diagnostics are never rendered, and synchronous disposal during save cannot restore DOM or errors. This adds no session acquisition, authority, retention, deployment or provider behavior.

## Canonical row model drilldown (#988)

The canonical Usage history now provides View usage for this model per authorized row. It reloads the existing protected endpoint with the exact model, preserving applied principal/request/time bounds, never substituting row principal in self mode. A fresh load resets cursors and pending CSV; paging/CSV retain model scope. Model draft follows the action, while unrelated edits are not applied. Audit filters are independent; detached controls, denial and disposal cannot revive reads. Loading, empty and error states remove old rows. This is not a complete-history aggregation, session acquisition or installed/live acceptance. See [plan](../docs/plans/988-canonical-model-drilldown.md).

## Canonical current-page cost coverage (#982)

The ready canonical Usage history page shows exact estimated and reported totals separately per currency, cost coverage, reported/partial/missing/invalid usage counts, possibly billed and duplicate counts. Missing amounts remain Unknown; explicit zero is retained. Duplicate rows remain included and flagged. The summary is current-page only, not an invoice, reconciliation or all-pages total; no extra request, authority or accounting write is introduced. Loading, empty/error, audit navigation, denial and disposal remove the summary with the current rows. See [plan](../docs/plans/982-canonical-page-cost-summary.md).

## Explicit filter reset (#984)

Clear filters resets only the active Usage/Audit tab to a fresh protected read with no principal/model/request/time/cursor. It clears invalid drafts, prior cursor history, pending reads/CSV and CSV delivery errors. Inactive tab filters remain intact. Account targets are preserved unless explicitly cleared. Fresh server authorization determines scope; the reset is not an identity or permission grant. Replaced/denied/disposed controls cannot act. Already downloaded files cannot be erased.

## Clear all history filters (#986)
The active Usage or Audit tab offers Clear filters, which clears only that tab's drafts and applied filters, cancels its pending JSON/CSV work, resets its cursor path and starts a fresh first-page authorized read. The other tab keeps its own filters. A recovered invalid draft becomes editable again with no transport request, and a retained control from a replaced view or after denial/disposal cannot dispatch. Reset grants nothing: the fresh read still authenticates, authorizes and awaits required audit, and a 401/403 on it terminally clears both histories and releases download leases once. This adds no session acquisition, retention, deployment or provider behavior.

## Canonical native filter submission (#988, #979)
Usage and Audit filters use a named native form. Enter and Apply filters each apply the existing exact filters once without document navigation; other controls do not submit. Validation and fresh authorization remain in the existing clients. Detached forms, denial and disposal cannot issue another read. This integrates only keyboard submission from #979, not its stacked page-size or runtime behavior.
