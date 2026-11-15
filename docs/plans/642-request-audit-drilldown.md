# Request audit drill-down (#642)

1. Reuse the existing authorized usage/audit history clients and UI mount. No authentication, permission, retention, SQL or public-entry changes.
2. Add a per-usage-row action which starts a fresh audit query with the exact principal and request ID, discarding unrelated audit filters and old cursor. Do not transfer usage model/time filters: audit events can precede usage and need not carry a model.
3. Render explicit correlation context and a return action. Retain the usage page, filters and drafts. An empty audit result does not prove no audit exists outside the caller's authorized view. Correlation is not billing reconciliation.
4. Keep pagination, retry and current-page CSV on the selected request. Manual audit filter application exits correlation context. Reopening even the same request refetches current authorization.
5. Write failing UI cases, implement the feature, then run UI/client regressions and a real loopback owned-HTTP/migrated-SQL integration case. Verify denial/disposal and stale callbacks cannot revive private content.
6. Validate browser behavior locally, typecheck, lint, plan checks; commit and open PR under sjungwon03. Require exact-head CI and independent formal approval before merge. Local/synthetic evidence is not installed/provider acceptance.
