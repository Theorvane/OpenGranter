# Cancellable canonical history reads (#642)

1. Add failing contract tests for user cancellation during initial and cursor-page JSON reads in both canonical review controllers; verify transport abort, no late data/denial, exact retry and sibling isolation.
2. Add a loading-only cancel method that retires the read revision before aborting the request. Keep the attempted filters/cursor for explicit retry, clear displayed data, and do not revoke the identity epoch.
3. Expose a Cancel loading button in the canonical history mount. Existing generation guards reject retained controls after navigation or teardown.
4. Run controller, mount, workspace, migrated-SQL/HTTP integration regressions, TypeScript and changed-file lint. Verify exact-head CI and independent formal approval before any merge.

No session/authentication/authority, public entry activation, retention, provider call or paid deployment. Existing uncommitted CSV cancellation and detail work in other worktrees is not included or modified. This builds on PR926 current-page refresh, not unrelated pricing changes.
