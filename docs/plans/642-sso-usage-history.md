# SSO usage history service (#642)

1. Implement the missing internal registered-key SSO usage read service for R4. Reuse current IAM, PostgreSQL usage history, filters, keyset pagination and CSV. No HTTP, session/BFF, runtime activation, schema or provider changes.
2. Authenticate current human binding and IAM on every call. Omitted principal uses usage:ReadSelf; explicit principal, even self, requires usage:ReadAll on principal:<id>. Explicit Deny wins. Revoked authentication cannot read usage SQL.
3. Snapshot input query before asynchronous work. Strict existing validation applies. Reuse content-free row projection and exact unknown/estimated/reported cost and duplicate markers; never invent totals or credentials.
4. Mandatory SSO-specific metadata audit finishes before any result is released, including denial/failure. Include only request ID, caller/current policy versions, target, mode, outcome and count. No JWT/raw query/CSV/content. Audit failure suppresses results. An injected writer is not durable-audit certification.
5. Meaningful RED: new real-signed-JWT + PGlite migrated database tests fail because production module is absent. GREEN: real SQL isolation/paging/filter/CSV, fresh IAM, disabled/binding revocation, invalid/expired token, invalid query, SQL failure and awaited/failed audit. No fixture-login or live-provider claim.
6. Run focused tests, typecheck, lint, planning scan and full check. Open PR against main, request exact-head independent formal review and require mandatory CI before merge. Session/API/UI integration and durable SSO usage audit composition remain release blockers.

Contract: [SSO usage history](../../contracts/sso-usage-history.md).
