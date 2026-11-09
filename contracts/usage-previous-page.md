# Usage previous-page navigation

- Issue: #642. [Plan](../docs/plans/642-usage-previous-page.md).
- Previous page refetches the preceding successful query through the same authorized transport; opaque cursor strings are copied exactly, not decoded, calculated or persisted.
- Only query filters are retained in memory, never historical rows or CSV blobs. A successful previous request removes one navigation entry; the response supplies the next cursor as usual.
- Refresh current page refetches the exact active cursor/filters and retains the query-only navigation chain across transient failure. Operator cancellation clears records and ignores late transport completion, but retains submitted queries for explicit recovery. No server-side rollback is implied.
- Applying filters or first-page retry starts a new navigation chain. Clear, reconnect and disposal remove the chain. Failed list/export and cancellation retain query-only scope; Retry current page refetches the exact submitted cursor/filters and restores previous navigation only after success. No rows, detail or CSV survive the failure. Invalid queries require correction and do not expose current-page retry. Superseded completions cannot restore it.
- CSV uses the currently displayed query; page changes revoke its old download. No claim of snapshot isolation or stable billing reconciliation across separate requests.
- No new identity, permission, session, route mount, schema or deployment approval.
