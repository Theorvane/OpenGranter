# Scoped usage runtime integration (#854)

## Issue and problem
Refs #637 and #642. The explicit SSO PostgreSQL listener routes catalog and token management but returns 404 for the merged usage API. The canonical path is /management/v1/usage (not /v1/usage).

## Scope and expected behavior
Compose the existing PostgreSQL SSO usage Fetch handler at its exact canonical path, with the same owned migrated connection and trusted RFC9068 configuration. Preserve JSON/CSV filters, scope, opaque pagination, mandatory durable metadata audit and private errors. Both static-browser-enabled and API-only listeners use the same dispatch. Do not change cookies, sessions, CSRF, IdP, schema, default startup or provider configuration. This does not authorize deployment or prove browser login.

## Design
Reuse createPostgresSsoUsageHistoryHandler inside the existing explicit startPostgresSsoManagementGateway. Do not add a second listener/connection or copy permission logic. Dispatch only exact usage pathname; existing token/catalog fallback remains unchanged. No new domain terms or costly architectural decision. Contracts: contracts/management-sso-usage-runtime.md; update PRD, architecture and acceptance. Session approval and frontend selection remain independent prerequisites for login/browser delivery.

## TDD plan
First add real loopback HTTP tests with signed in-memory test JWTs, migrated PGlite SQL and persisted usage. Expect RED 404 on canonical usage path. Test JSON/CSV, continuation, self/other isolation, explicit Deny, expired/unbound/missing tokens, audit attribution, SQL/audit failure, exact-path and method rejection, existing catalog/token/static dispatch, one open/close and idempotent shutdown. No provider calls. Then add the smallest composition and dispatch change. Run focused runtime tests, typecheck, lint, document and compatibility checks and standard npm run check; distinguish resource failure from functional evidence.

## Delivery
Issue854 branch from main6757eee. No session/runtime deployed activation, production or paid calls. Require fresh exact-head CI and formal independent approval before merge. Rollback removes only the new usage dispatch; no migration needed. Report socket tests separately from installed PostgreSQL, browser login and live provider acceptance, all still open.

## Execution evidence (2026-11-11 12:00 KST)
- RED /tmp/og-1200-red.log: both real-socket variants fail 404 versus expected200 on canonical usage API.
- Minimal production change: compose the existing durable usage handler on the existing connection and dispatch the exact canonical pathname (three added lines).
- Initial post-implementation test expected expiry one second ago to fail, but the existing verifier intentionally accepts clock tolerance. Corrected the expired fixture to one hour ago; did not change token verification or relax any assertions.
- GREEN /tmp/og-1200-runtime-green.log:13/13 zero skips, new API2 plus existing catalog2/browser4/management5; production JSON/CSV clients also traverse the real listener. JWTs are signed test identities; database is migrated embedded SQL, not installed PostgreSQL.
- Typecheck, lint (42 existing warnings/161 infos), planning/link/secret scan, six offline compatibility pins and diff checks PASS. Standard npm run check started /tmp/og-1200-fullcheck.log; final result pending, not claimed successful.
- No production or paid calls, session policy changes, deployment or merge. Browser login, installed persistence and original full PRD remain open.

## Main integration (2026-11-12 03:30 KST)

Merged main b22e3f3 into the existing PR855 branch in an isolated worktree; preserved both PRD additions rather than overwriting either. Production remains the same three-line owned usage dispatch. Fresh real-loopback runtime regression: 13/13 passed, zero skips (usage, catalog, browser and token-management variants), including current migrations. Full TypeScript, planning/link/contract checks and diff checks passed. Log: /tmp/og-20261112-0330-integration.log. This is generated test-JWT plus migrated embedded SQL, not browser login, installed PostgreSQL or provider certification. Fresh exact-head review and hosted CI are still required.
