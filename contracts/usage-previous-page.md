# Usage previous-page navigation

- Issue: #642. [Plan](../docs/plans/642-usage-previous-page.md).
- Previous page refetches the preceding successful query through the same authorized transport; opaque cursor strings are copied exactly, not decoded, calculated or persisted.
- Only query filters are retained in memory, never historical rows or CSV blobs. A successful previous request removes one navigation entry; the response supplies the next cursor as usual.
- Applying filters or first-page retry starts a new navigation chain. Failed list/export, clear, reconnect and disposal remove the chain. Superseded completions cannot restore it.
- CSV uses the currently displayed query; page changes revoke its old download. No claim of snapshot isolation or stable billing reconciliation across separate requests.
- No new identity, permission, session, route mount, schema or deployment approval.
