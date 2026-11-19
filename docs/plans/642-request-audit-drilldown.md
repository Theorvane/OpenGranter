# Request audit drill-down (#642)

1. Reuse the existing authorized usage/audit history clients and UI mount. No authentication, permission, retention, SQL or public-entry changes.
2. Add a per-usage-row action which starts a fresh audit query with the exact principal and request ID, discarding unrelated audit filters and old cursor. Do not transfer usage model/time filters: audit events can precede usage and need not carry a model.
3. Render explicit correlation context and a return action. Retain the usage page, filters and drafts. On Back to usage, use the same fresh exact-page read as the Usage tab before rendering any cached rows; preserve submitted filters/current cursor independently of unsubmitted drafts. Cover changed authorization (401/403), transport failure, and successful re-entry with public mount regression tests. No new authority or endpoint is introduced. An empty audit result does not prove no audit exists outside the caller's authorized view. Correlation is not billing reconciliation.
4. Keep pagination, retry and current-page CSV on the selected request. Manual audit filter application exits correlation context. Reopening even the same request refetches current authorization.
5. Write failing UI cases, implement the feature, then run UI/client regressions and a real loopback owned-HTTP/migrated-SQL integration case. Verify denial/disposal and stale callbacks cannot revive private content.
6. Validate browser behavior locally, typecheck, lint, plan checks; commit and open PR under sjungwon03. Require exact-head CI and independent formal approval before merge. Local/synthetic evidence is not installed/provider acceptance.

## PR921 local integration regression evidence

The Back action now shares the Usage-tab fresh-read path. Before the fix,
`node --experimental-strip-types --test --test-name-pattern='Back to usage rechecks' test/management-request-audit.test.ts`
failed all three 401/403/503 regressions at the expected missing request assertion
(actual two requests, expected three). After the fix, these cases verify pending
row suppression, exact-query recheck, denial/failure clearing and stale callbacks.
Existing success cases retain draft, selected cursor, applied range, pagination
and exact correlation assertions, including the owned HTTP/SQL case.

Local verification: 176/176 tests across 12 focused history/request-audit and
operations suites passed with zero skipped; repository typecheck, lint, planning
checks, six pinned compatibility checks and diff whitespace check passed. Lint
retains 42 existing warnings and 181 infos. Full `npm run check`/all-suite testing
was not run. Tests used a credential-free environment and existing local locked
dependencies; no remote write, deployment or installed/company SSO claim.
