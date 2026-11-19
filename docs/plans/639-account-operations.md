# Account in management operations (#637 / #639)

1. Add canonical Account938 to existing inner History / Proxy tokens navigation. Preserve History initial screen and outer Models owner.
2. Dispose previous child before mounting. Use same caller-authorized request; no writes/download on Account and no session acquisition, credentials, public activation or schema changes.
3. Account401/403 locks whole mount. Expiry/logout/replacement clears identity and aborts reads through body completion; stale responses/controls cannot revive a prior view.
4. Missing-navigation RED before implementation, then operations/session/Account regressions, actual owned HTTP and embedded PostgreSQL, browser bundle and real browser. Full TypeScript and changed-file lint.
5. Dependent PR against939; preserves and finishes uncommitted 16:00 integration in separate 17:00 worktree; exact required CI plus independent formal approval before merge. Synthetic JWT/embedded PostgreSQL is not installed SSO/deployment/provider E2E.
