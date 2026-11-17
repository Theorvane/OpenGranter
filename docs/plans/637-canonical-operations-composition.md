# Canonical operations composition (#637, #640)

## Plan
1. Preserve canonical review as read-only; introduce a separate explicit operations factory. No CLI/runtime activation.
2. Route only the two existing exact proxy-token paths to the existing registered-key human SSO management handler. Delegate canonical Account, Models and history reads unchanged; optionally serve the existing trusted public artifact.
3. Reuse one trusted SQL client and configuration, current IAM, existing lifetime rules, transactional decisions and mandatory authentication audit. Ignore callback overrides. Never infer a cookie, proxy-token, session or grant.
4. RED: run socket integration against a provisional read-only delegation and observe issue 404 instead of201. GREEN: compose existing authenticated mutation handler and verify lifecycle, fresh Deny, identity revocation, audit failure rollback, no default writes/override/endpoint fallback.
5. Run focused and existing composition tests, TypeScript, Biome and scripts check; PR exact-head CI and independent formal approval before merge.

## Boundaries
No new endpoint or policy action, schema, login/session/CSRF/CORS/ingress contract, paid call or installed activation. Caller owns migrations, autocommit connection, DB lifecycle, approved artifact and listening. PGlite/JWT/socket results are not real IdP/browser/provider acceptance. Roll back by not selecting the new factory.
