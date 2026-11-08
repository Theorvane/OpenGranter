# SSO catalog rendering authority adapter

## Issue and problem
- Issue: #641, parent #637; browser foundation #639.
- The explicit SSO transport and lifecycle exist, but the observer/expiry adapter still hardcodes proxy discovery. DOM integration would otherwise duplicate expiry logic.

## Scope and expected behavior
1. Add createSsoManagementCatalogAuthority using the existing SSO lifecycle.
2. Preserve the proxy factory, trusted request-port grant, expiry validation, observer updates and cancellation.
3. Never infer SSO-to-proxy authority or choose an endpoint from UI input. No credentials, BFF, session acquisition, runtime activation, DDL or provider calls.

## Design and dependencies
- Reuse one private expiry/observer implementation with an internal lifecycle factory, not a public arbitrary factory option.
- The frontend owns DOM mounting; backend session decisions remain unresolved. No browser or installed acceptance is implied.
- Existing management catalog/SSO HTTP contracts remain unchanged; fresh server authentication, IAM and durable audit remain mandatory.

## TDD plan
1. RED: explicit SSO authority cannot load list/detail because its export is absent.
2. Test loading/list/detail/empty/error notifications, encoded slash IDs, count alias, expiry during pending reads, identity replacement, 401/403 lockout and disposal.
3. Add the narrow factory and share unchanged expiry/observer machinery. Run both authority and client/lifecycle suites, typecheck, lint, planning checker and npm run check.

## Delivery and risk
- Exact-head required CI and independent formal approval are required before merge. Rollback removes the new factory.
- Browser login, installed PostgreSQL and real providers remain separate gates.

## Local evidence
- RED: Node22 import failed for missing factory export before production changes.
- GREEN: SSO authority six cases; combined proxy/SSO authority, lifecycle and transport tests 55/55, zero skips.
- Native TypeScript noEmit PASS; whole-tree native Biome PASS (42 warnings, 150 infos); planning and whitespace PASS.
- npm run check blocked: npm executable inaccessible/empty; explicit npm CLI missing walk-up-path. Full-check success not claimed. Direct complete test suite started, results pending.
- No browser login, installed PostgreSQL, runtime activation or real-provider acceptance.
