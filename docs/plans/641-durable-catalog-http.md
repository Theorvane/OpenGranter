# Durable PostgreSQL SSO catalog HTTP composition

## Issue and problem
Issue #641, parent #637. The existing HTTP boundary requires callers to compose a service and an audit callback manually. A mistaken no-op callback can expose metadata without durable audit. Provide an explicit production-oriented composition rather than change session/runtime ownership.

## Scope and expected behavior
Compose the registered-key RFC9068 verifier, fresh PostgreSQL IAM/catalog, mandatory dedicated PostgreSQL SSO audit and existing list/detail HTTP projection. Expose Fetch handler and non-listening Node server factories. No injectable audit callback is accepted by these factories. Preserve primitive dependency-injection APIs for tests and other integrations.

## Design
One trusted SQL client and clock serve authentication/catalog and audit. Select known dependencies explicitly, never spread caller-supplied catalog or writeAudit overrides. Reuse existing behavior and migrations; no new HTTP paths, authorities, tokens or provider calls. Cookie sessions, browser mounting and runtime activation remain backend-owned and unresolved outside this module. No transaction or atomic revocation claim.

## TDD plan
First import the new factory from a public integration test; expected RED is missing module. Then run signed JWT and migrated PGlite through real loopback HTTP: list/detail, fresh Deny, revoked binding, anonymous denial and missing audit table. Assert persisted attribution, no client request-ID trust or secret leakage. A deferred audit insert must block response completion; failed audit must suppress authenticated and anonymous output. Smallest implementation wires existing services and handlers without reimplementing their logic.

## Delivery
Update PRD, acceptance and SSO catalog HTTP contract. Run focused Node22 tests, strict types, lint, planning check and full npm run check. Require exact-head CI and independent formal approval. Rollback removes only the optional composition. Local PGlite/loopback is not installed PostgreSQL, company IdP, browser or provider acceptance.
