# Model summary to scoped usage API drilldown (#642)

1. Add explicit filter actions to current-page model groups using the existing validating API. Preserve principal, UTC bounds and page size, replace the exact model, discard cursor/history, drafts and CSV continuation. Do not silently filter just the visible subset.
2. Reuse the owning render/authority guarded button factory. Detached controls, logout, expiry and disposal cannot read. No session, permission, provider, schema or deployment changes.
3. Establish source/artifact RED/GREEN: exact unsafe aliases, retained bounds, paging reset, draft synchronization, loading, stale controls, denial and late responses. Exercise signed SSO HTTP, migrated PGlite, fresh IAM and mandatory audit.
4. Run focused and full checks; require exact-head CI and independent formal approval plus parent gates before merge. Native browser/session and installed acceptance remain separate.
