# Integrate SSO catalog observer authority on current main

## Issue and problem
- Issue: #641, parent #637 and browser foundation #639.
- Main now has the explicit SSO client/lifecycle (#790), but its observer/expiry authority still hardcodes proxy discovery. Historical #689 remains stacked on a superseded client branch.

## Scope and expected behavior
1. Integrate the existing explicit SSO authority without changing frontend-owned DOM/page files or replaying the stale client implementation.
2. Reuse proxy authority expiry, notifications, cancellation, identity replacement and 401/403 lockout. Keep the proxy factory unchanged.
3. Exercise authority through actual loopback Node HTTP, signed test JWT, migrated PGlite, fresh IAM and mandatory durable audit. No browser credentials, BFF, session acquisition, DDL/runtime activation, inference or deployment.

## Design
- Select the lifecycle only in two explicit factories sharing one private authority implementation; do not expose arbitrary endpoints or lifecycle injection.
- Trusted request/expiry grants remain caller-owned and are not authentication. Session decision #786 is still proposed, not approved. Existing contract: contracts/sso-model-catalog-http.md.
- DOM/page ownership remains frontend. Preserve proxy published metadata and SSO basic projection.

## TDD plan
1. Restore historical #689 authority public-boundary tests and add an actual HTTP observer/expiry integration test before production changes; record missing-export RED.
2. Cover list/detail/loading/empty/error, fresh Deny, revoked binding, failed required audit, expiry suppression, identity replacement and teardown.
3. Add the narrow factory/shared machinery; run focused tests, typecheck, lint, planning/schema checks and full check where resources permit.

## Delivery
- Require independent formal approval and every required CI success at exact HEAD before match-head merge.
- Rollback removes the new authority factory. Company SSO/browser login, installed PostgreSQL, live providers and deployment remain unverified.
- Evidence will distinguish local fake ports, real loopback HTTP, CI and installed acceptance.

## Local evidence
- RED: both restored authority and actual HTTP integration modules fail importing the missing createSsoManagementCatalogAuthority export before production changes.
- GREEN: combined management catalog suites and actual signed-test-JWT/Node-HTTP/migrated-PGlite integration pass 104/104, zero failures/skips. Covers fresh Deny, revoked binding, mandatory audit failure and local expiry suppressing further HTTP reads.
- Native TypeScript noEmit PASS. Full-tree Biome PASS with 42 existing warnings and 158 informational diagnostics. Planning checker, all six pinned schema checks and whitespace checks PASS.
- Standard npm run check started separately; no completed full-suite result claimed here. CI is an independent required gate.
- No native-browser/company-SSO/installed-PostgreSQL/provider/deployment acceptance is claimed.
