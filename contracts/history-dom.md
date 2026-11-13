# History management DOM contract (#642)

The opt-in mountHistoryWorkspace(root, trustedSsoRequest, downloadLease) connects existing scoped usage/audit clients to native controls. It is not an authenticator. The caller must dispose on known logout, expiry and identity change; the injected download lease belongs exclusively to this mount. The public browser entry is not activated.

- Usage loads initially; Audit loads lazily when selected. Each tab has independent principal/model/time filters; audit additionally offers request ID. From/to are explicit Unix milliseconds, inclusive/exclusive. Invalid or inverted ranges cannot reach the transport. Searches reset cursors; next/previous use existing client cursor validation.
- Loading and empty views contain no prior rows. Unavailable reads offer retry; invalid filters remain editable. Native disabled paging/export buttons cannot send requests; retained handlers from replaced views cannot act.
- Usage displays exact estimated/reported decimal strings separately, price version/source, unknown token/cost data, comparison metadata, possible duplicate and possibly billed markers. No float conversion or fabricated invoice reconciliation. Audit renders only timestamp/kind/principal/request metadata, never arbitrary details or prompt/response content. All external values use textContent.
- CSV explicitly exports only the currently loaded page/filter/cursor via existing authorized boundaries; no automatic traversal. The trusted download adapter can be createCsvDownload. Export failures display generic diagnostics. Started downloads cannot be erased on logout.
- Fresh 401/403 in either history clears both tabs and releases download leases once. Dispose clears the DOM, invalidates retained controls, cancels pending work and releases leases once. Late exports after denial/disposal cannot save bytes. No credential storage, session acquisition, new IAM/audit policy, runtime activation or installed acceptance is implied.

Evidence: test/management-history-app.test.ts and existing shared workspace/client suites. Native browser preview uses synthetic responses and is not company SSO, installed PostgreSQL or live-provider acceptance.
