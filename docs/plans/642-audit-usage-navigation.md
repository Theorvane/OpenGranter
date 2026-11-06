# Audit to scoped usage navigation (#642)

1. Reuse existing audit and usage review contracts. Add a trusted optional audit event action to inspect usage for its exact request and principal; retain only submitted model/UTC/page-size bounds. Discard audit cursors, history, CSV and drafts. No global trace or billing inference.
2. Before production code, add meaningful failing source and built-artifact workspace tests for actual transport paths, scope reset, denial and authority lifecycle. Use existing HTTP/IAM tests as independent regression evidence, not live SSO acceptance.
3. Extend the trusted usage mount with initial filters and compose audit-to-usage navigation in the existing source-only workspace. Initial filters are query hints, never authority. Explicit principal filtering still requires usage ReadAll, even for self; never retry with broader or implicit scope.
4. Keep current authority generation, timer, detached-control, cancellation, logout and denial clearing. Normal navigation and fresh authorization discard trace scope. No entry, session, API, schema, provider or runtime activation.
5. Run focused source/artifact tests, existing HTTP/SQL/IAM regressions, typecheck, lint, planning and compatibility. Publish exact-head PR; require all ancestor/head CI and valid formal approval before merge.
