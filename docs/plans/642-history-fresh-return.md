# Fresh history page re-entry (#642)

1. Reuse existing review.retry exact-page transport; no new authority, polling or endpoints.
2. Changing to a loaded tab synchronously clears prior rows and freshly GETs applied filters/current cursor; never render stale target rows before loading. Preserve invalid-filter state and coalesce in-flight tab reads.
3. Add explicit Refresh current page for ready/empty pages using applied filters, not unsubmitted drafts. Fresh 401/403 clears both histories through existing boundaries.
4. Establish RED/GREEN DOM integration, exact opaque cursor and owned HTTP/embedded PostgreSQL revocation tests. Distinguish synthetic SSO from installed/company login.
5. Run focused tests/typecheck/lint/scripts/pins; publish dependent PR and request exact-HEAD review. No merge without required CI and independent formal approval.

No session acquisition, new grants/schema/retention, public activation, deployment or paid calls. Existing usage-record worktree untouched.
