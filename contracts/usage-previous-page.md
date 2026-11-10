# Usage previous-page navigation

- Issue: #642. [Plan](../docs/plans/642-usage-previous-page.md).
- Previous page refetches the preceding successful query through the same authorized transport; opaque cursor strings are copied exactly, not decoded, calculated or persisted.
- Only query filters are retained in memory, never historical rows or CSV blobs. A successful previous request removes one navigation entry; the response supplies the next cursor as usual.
- Refresh current page refetches the exact active cursor/filters and retains the query-only navigation chain across transient failure. Operator cancellation clears records and ignores late transport completion, but retains submitted queries for explicit recovery. No server-side rollback is implied.
- Applying filters or first-page retry starts a new navigation chain. Clear, reconnect and disposal remove the chain. Failed list/export and cancellation retain query-only scope; Retry current page refetches the exact submitted cursor/filters and restores previous navigation only after success. No rows, detail or CSV survive the failure. Invalid queries require correction and do not expose current-page retry. Superseded completions cannot restore it.
- CSV uses the currently displayed query; page changes revoke its old download. No claim of snapshot isolation or stable billing reconciliation across separate requests.
- No new identity, permission, session, route mount, schema or deployment approval.

## Browser download failure containment (#642)

- If Blob/object-URL creation fails after a successful authorized CSV response, discard the page and export, display only the existing safe unavailable state, and allow explicit current-page retry through the same server authorization and audit boundary. Keep submitted query-only navigation, never CSV text or exception details.
- Clear local download references before best-effort URL revocation. Browser cleanup errors cannot interrupt logout/expiry cleanup, keep detached download controls active, or contaminate renewed authority. A platform revocation failure cannot guarantee the browser released its resource; no claim of secure erasure is made.

## Non-stalling continuation (#642)

- JSON and CSV reads reject the whole response as unavailable if its next cursor repeats the exact cursor submitted for that request. Capture that value before asynchronous transport. No data/download or continuation control is published for the stalled response. The API adapter already enforces decoded ordering; this client check also protects an explicitly supplied transport from immediate stalls.
- Do not decode, reorder, fabricate or automatically follow cursors. Different opaque cursors and terminal null remain valid. No visited-cursor persistence or arbitrary multi-page cycle detection is introduced.
- Existing recovery retains submitted query-only navigation: JSON retries its failed current page; a failed CSV continuation recovers by re-reading the displayed JSON page, not by replaying/exporting the failed continuation automatically. See [plan](../docs/plans/642-usage-cursor-progress.md).
