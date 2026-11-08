# SSO audit workspace (#637 / #642)

1. Reuse the bounded SSO audit transport and existing trusted grant contract; do not create identity/session authority or touch frontend-owned DOM.
2. Add a headless controller for filter submission, next/previous pages and explicit current-page CSV. Navigation must use captured query values, never infer cursor offsets or accumulate events.
3. Clear pages, export and filter history on logout, expiry, denial, renewal and disposal; suppress stale completions and fail closed on uncertain clocks.
4. Test real transport responses, empty/error/denial, timer expiry, late responses, mutable callers and reentrant observers (RED before implementation).
5. Run focused tests, full typecheck/lint/scripts, browser bundle; publish a draft PR for exact-head CI and formal review. No installed/provider acceptance claim.
