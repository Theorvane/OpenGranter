# Gateway attempt price handoff

1. Preserve the internal attempt-start pricing contract from #929. Add only an optional trusted composition port to existing gateway and PostgreSQL handler types; no HTTP/config field, catalog policy, session change or runtime activation.
2. First demonstrate RED for managed/delegated JSON, text SSE and function SSE: a configured resolver must run before dispatch and the ledger must retain its immutable estimate.
3. Forward the port through every existing route dispatch path. Reuse route authorization, limits, audit and accounting failures without defaults or fallback around invalid pricing.
4. Verify missing price remains unknown; deny/limit/authentication gates never resolve prices; resolver failure prevents provider calls and successful SSE termination. Check client input cannot choose or spoof a price.
5. Exercise an actual loopback HTTP request with migrated embedded SQL and the existing PostgreSQL composition, usage history JSON and CSV. Separate this evidence from installed PostgreSQL, browser, SSO and live provider acceptance.
6. Run targeted regressions, full typecheck and changed-file lint. Publish a stacked draft; require independent exact-head formal approval and all required CI for both it and its base before merge.
