# Canonical operations composition (#637, #640)

## Plan
1. Preserve canonical review as read-only; introduce a separate explicit operations factory. No CLI/runtime activation.
2. Route only the two existing exact proxy-token paths to the existing registered-key human SSO management handler. Delegate canonical Account, Models and history reads unchanged; optionally serve the existing trusted public artifact.
3. Reuse one trusted SQL client and configuration, current IAM, existing lifetime rules, transactional decisions and mandatory authentication audit. Ignore callback overrides. Never infer a cookie, proxy-token, session or grant.
4. RED: run socket integration against a provisional read-only delegation and observe issue 404 instead of201. GREEN: compose existing authenticated mutation handler and verify lifecycle, fresh Deny, identity revocation, audit failure rollback, no default writes/override/endpoint fallback.
5. Run focused and existing composition tests, TypeScript, Biome and scripts check; PR exact-head CI and independent formal approval before merge.

## Boundaries
No new endpoint or policy action, schema, login/session/CSRF/CORS/ingress contract, paid call or installed activation. Caller owns migrations, autocommit connection, DB lifecycle, approved artifact and listening. PGlite/JWT/socket results are not real IdP/browser/provider acceptance. Roll back by not selecting the new factory.

## Canonical reconciliation (2026-11-20 01:30 KST)
Current parent954 already contains the equivalent public createPostgresSsoOperationsHandler/Server factories. Preserve these as the sole implementation; retain the newer canonical factory names as compatibility exports for the existing child PRs rather than duplicating routing. Harden only the shared composition with no-store/nosniff token responses and private503 exception fallback. No runtime/session/DDL change. First run existing public lifecycle/security tests through the aliases against the unmodified shared implementation (RED: missing nosniff), then add smallest shared hardening and run both suites plus current Account/Models/history/browser regressions. Also test a throwing request-ID source through handler and real HTTP: no authentication/SQL/secret reflection.

Reconciliation evidence: RED shared-factory baseline2PASS/2FAIL/0SKIP, expected nosniff missing on authentication and request-ID failure; GREEN14PASS/0FAIL/0SKIP across composition and shared real-HTTP suites. Full strict TypeScript, full Biome, scripts/check.py and pinned compatibility PASS. Expanded concurrent-with-full-check regression101PASS with3test-file SIGKILL (canonical-current-principal, postgres-sso-usage-history-http, sso-operations-http); this is a resource-limited failure, not an all-green result. Full standard npm run check launched with CPU affinity0; inspect /tmp/og-200130-955-fullcheck.log before making any full-check claim. No browser or deployed/native-PostgreSQL/IdP/provider acceptance added.
