# SSO usage history service (#642)

1. Implement the missing internal registered-key SSO usage read service for R4. Reuse current IAM, PostgreSQL usage history, filters, keyset pagination and CSV. No HTTP, session/BFF, runtime activation, schema or provider changes.
2. Authenticate current human binding and IAM on every call. Omitted principal uses usage:ReadSelf; explicit principal, even self, requires usage:ReadAll on principal:<id>. Explicit Deny wins. Revoked authentication cannot read usage SQL.
3. Snapshot input query before asynchronous work. Strict existing validation applies. Reuse content-free row projection and exact unknown/estimated/reported cost and duplicate markers; never invent totals or credentials.
4. Mandatory SSO-specific metadata audit finishes before any result is released, including denial/failure. Include only request ID, caller/current policy versions, target, mode, outcome and count. No JWT/raw query/CSV/content. Audit failure suppresses results. An injected writer is not durable-audit certification.
5. Meaningful RED: new real-signed-JWT + PGlite migrated database tests fail because production module is absent. GREEN: real SQL isolation/paging/filter/CSV, fresh IAM, disabled/binding revocation, invalid/expired token, invalid query, SQL failure and awaited/failed audit. No fixture-login or live-provider claim.
6. Run focused tests, typecheck, lint, planning scan and full check. Open PR against main, request exact-head independent formal review and require mandatory CI before merge. Session/API/UI integration and durable SSO usage audit composition remain release blockers.

Contract: [SSO usage history](../../contracts/sso-usage-history.md).

## Local evidence

Initial production-module RED is saved in /tmp/og-1900-usage-red.log. Self-review added a meaningful oversized-cursor RED (513-character stored attempt ID returned an unusable cursor), fixed by the same 512-character continuation bound as the proxy gateway. Final focused suite covers 11 new SSO usage cases plus existing SSO catalog and PostgreSQL reader regressions. These use real signed ephemeral JWTs and SQL in migrated PGlite, not installed PostgreSQL or an IdP login.

## Review correction: encoded continuation round trip

The formal review on 71f1382 found that the 512-character guard does not imply the 2048-character encoded parser bound for UTF-8 IDs. Before releasing a continuation, encode it and validate it with the existing public cursor parser; reject the page as unavailable with zero audited count if it cannot be consumed. Preserve parser limits and existing authorization/audit semantics. Add real migrated-SQL regressions for oversized multibyte JSON/CSV pages, accepted ASCII/multibyte round trips, final pages without continuation, and failed mandatory audit. No session, schema, routing, UI or deployment change.

Review-correction evidence (2026-11-09): two new real PGlite JSON/CSV regressions failed on the reviewed head because it released an overlong continuation. After invoking parseUsageCursor on the encoded continuation, 42/42 focused SSO usage/catalog/PostgreSQL reader tests pass, zero skips. Typecheck, full-tree lint and planning/contract/secret scan pass. Logs in the coordinator workspace: og-2030-cursor-red.log and og-2030-cursor-green.log. The local npm launcher cannot load walk-up-path, so the exact package check components are running explicitly with Node 22; this is not a successful npm run check claim. No browser, installed PostgreSQL, production IdP or provider run.
