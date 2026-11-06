# Scoped history response cache safety (#642)

1. Preserve existing /v1/audit and /v1/usage contracts, IAM, required audit and route set. Both endpoints return private principal-scoped metadata; do not permit cache storage of success or errors.
2. Add RED tests for JSON/CSV success, auth/query/permission/storage/audit errors and unsupported methods at the Fetch handler, plus real loopback HTTP success and thrown-handler fallback.
3. Apply no-store at scoped history boundaries, including Node adapter error fallbacks. Do not change chat caching or add /api aliases.
4. Verify focused regression, typecheck/lint/planning, then exact-head CI and independent formal approval before merge. Native-browser/SSO/installed PostgreSQL/provider acceptance remain separate.
