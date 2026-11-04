# Owned SSO catalog listener integration

## Issue and problem
- Refs #641 and parent #637. The reviewed durable catalog HTTP boundary is not reachable from the owned management listener.

## Scope and expected behavior
- Mount existing `/management/v1/models` list and encoded-detail reads on the explicitly started SSO management listener, sharing its migrated database and registered issuer/audience/keys.
- Preserve public optional browser assets and proxy-token operations. No inference route, cookie/session grant, browser bearer injection, provider call or new IAM right.
- Existing fresh binding/IAM and mandatory durable SSO audit apply unchanged.

## Design
1. Compose token and catalog handlers on the owned connection, dispatch exact catalog base/prefix only.
2. Wrap the combined application in the optional static browser handler, otherwise adapt to Node directly.
3. Reuse existing server/connection lifecycle and migration ownership. Do not add another listener or database.
- Dependency: #682 durable composition. Browser session/CSRF/ingress decisions remain unresolved; this is not authenticated browser acceptance.
- Contracts: `contracts/sso-management-runtime.md`, PRD and acceptance integration sections.

## TDD plan
1. Run real loopback runtime with a local registered JWT issuer and migrated PGlite connection. Seed current IAM/catalog through SQL only after startup. Expect list/detail success and durable audit. Before implementation the list returns 404 (RED).
2. Check fresh Deny, revoked binding, anonymous denial, missing audit storage, unrelated/proxy paths, static default-off/default-on and token auth boundary.
3. Ensure one opened connection and idempotent shutdown. Run focused existing runtime/HTTP suites, typecheck, lint, full npm run check and planning checker.

## Delivery
- Commit implementation plus behavior tests with exact revision evidence and PR against main after dependency lands.
- Risks: local PGlite and generated JWT do not establish installed PostgreSQL, company IdP, browser session or live-provider correctness. Rollback is reverting runtime dispatch only; no schema changes.

## Review correction: adapter failures (#683)
1. Reproduce Fetch-forbidden TRACE over real Node HTTP on token/catalog paths, with and without browser assets. Require fixed 503 internal_error, no-store, and no request/authentication leakage.
2. Keep the existing management adapter error contract while composing static and application handlers; do not change the generic gateway adapter or frontend-owned files.
3. Run regression RED before implementation, then GREEN plus runtime, browser HTTP, token HTTP and catalog HTTP suites. Request renewed formal exact-head review and full CI.
