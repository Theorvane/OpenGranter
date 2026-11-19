# Current-page refresh on the canonical history screen (#642)

1. Reuse the existing review retry operation; do not add a transport, renderer or authority boundary. PR834 concerns a different legacy usage-app surface; this change is only history-app.
2. Add an explicit refresh control for ready/empty Usage and Audit pages. Re-read the applied filters and exact opaque current cursor, not draft edits. Preserve previous-page navigation.
3. Disable refresh while idle/loading/failure; retain explicit Retry for failed reads. Existing generation, shared-denial and teardown guards must still apply.
4. RED: demonstrate the missing control in both histories, including empty pages, second-page filters, failure/retry, in-flight stale clicks and fresh denial. GREEN: run these tests and existing history/operations suites, typecheck and lint.
5. Require exact-head CI and independent formal approval before merge. No browser login, public-entry activation, provider call or deployment is added.
