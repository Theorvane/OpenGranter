# Shared lifecycle for token administration

## Issue and problem
- Issue: #640, parent #637. Issuance and revocation are independently mountable, but no shared management surface invalidates both on fresh authentication/authorization failure.

## Scope and expected behavior
- Compose existing reviewed issuance/revocation panels with one approved request port. No automatic mutations.
- A fresh 401 or 403 from either operation stops both panels, aborts sibling requests and clears even detached owned secret nodes before showing a terminal boundary message. Stale callbacks and late results cannot restart work.
- Caller must dispose on logout, identity change, known expiry or navigation. Clear/abort does not revoke or roll back an already committed mutation.
- Out of scope: navigation/build files, session/CSRF/IdP configuration, IAM or policy changes, DB, provider calls and deployment.

## Design
- Add only token-management-panel.ts; reuse CatalogElement/CatalogRequest and approved panels, no new endpoint/schema.
- Shared wrapper rejects work after disposal/terminal denial without calling underlying port. Child disposal clears one-time credentials and aborts requests. Transport errors retain existing uncertain-outcome behavior, not a fabricated auth denial.
- Independent mounting remains supported. No new domain terms or ADR trade-off. Canonical FE mount and approved session/runtime remain external dependencies.
- Docs: [contract](../../contracts/token-management-panel.md), PRD, architecture, acceptance.

## TDD plan
- Baseline direct composition must fail behavioral assertions for sibling secret clearing, shared terminal lock, pending abort and late result suppression (not import errors).
- Cover cancel/no-request, exact confirmed payload, success, 401/403 from either panel, late success/rejection, explicit disposal, errors, duplicates and independent roots.
- Run focused token/SSO regressions, full TypeScript, Biome, document/contract checks and aggregate check; distinguish controlled ports from real API/browser/installed evidence.

## Delivery
- Issue branch, signed-off commit, PR, exact-head CI and independent formal review before merge.
- Rollback removes additive composition only. Existing issued credentials need explicit revocation, not UI cleanup.

## Verification checkpoint (2026-11-13)
- Recovered the preceding uncommitted implementation into an isolated issue branch without modifying its source worktree.
- Direct-composition baseline: 5 pass, 10 behavioral failures, zero skipped (including loopback denial cleanup). Shared lifecycle implementation: 15/15 pass, zero skipped.
- Selected token/SSO HTTP regression: 168/168 pass, zero skipped. Full TypeScript and changed-file Biome pass; planning/contracts/links/fixture-secret checker passes.
- The real loopback Node HTTP test uses controlled authentication/services and synthetic values, not a real IdP, PostgreSQL lifecycle or installed runtime.
- Aggregate check is running separately; no aggregate or installed/live success is claimed. CI and independent exact-head formal approval remain required before merge.
