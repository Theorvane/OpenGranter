# Persist Token-Management Authorization Decisions

## Issue and problem

- Issue: #67
- Deployments currently have separate IAM token-management and PostgreSQL credential primitives, with no persistent decision adapter or internal composition.

## Scope and expected behavior

Persist nonsecret decisions before mutation and compose the existing coordinator with PostgreSQL credential storage. Required audit failures stop issuance and revocation. Default Deny, explicit Deny, inactive actors, and unknown owners remain denied. No public management API, SSO, retention, history reader, or live policy refresh is introduced.

## Design

Migration `008` creates a dedicated decision table with actor, target owner, request, optional credential, operation, outcome, policy versions, and occurrence time. Unknown-owner denials permit a null target. A projection validates and copies only known fields. Dedicated storage avoids falsely assigning an SSO actor a proxy credential or mixing management decisions into gateway events.

`createPostgresTokenManagementCoordinator` accepts trusted database and clock ports and delegates existing policy behavior to the internal coordinator. Its caller must authenticate the actor and resolve policies. A grant records authorization before mutation; it does not certify completion. Existing atomic lifecycle events prove successful issuance or revocation. Both records correlate through request and actor identifiers. No atomicity across decision and mutation, exactly-once decisions, or tamper resistance is promised.

See [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). The public management authentication contract remains open.

## TDD plan

First add public-boundary integration and projection tests; the initial run must fail on the absent modules. Cover authorized issue/verify/revoke, denied issue/revoke, inactive and unknown owners, required-audit failure, mutation failure after a grant, invalid metadata/clocks, safe driver failures, and removal of extra secrets/content. Implement migration, projection, append adapter, and internal composition. Run focused tests, then `npm run check`.

## Delivery

Create issue and branch, write this plan, record red, implement, record green, update documents and migration expectations, run full checks, and open a ready PR. An additive migration can remain when reverting application code. Grants without lifecycle events require operational investigation; automated reconciliation and retention remain outside scope.

## Verification

Pending implementation.

- Red: `node --experimental-strip-types test/postgres-token-management.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the absent decision adapter.
- Green: the same command passed all seven new tests after implementation.
- Full gate: `npm run check` passed type checking, Biome, 265 tests, and planning/link/contract/fixture checks. One real PostgreSQL integration test skipped locally because no explicit database URL was set; CI provisions PostgreSQL and runs it.
- `git diff --check` passed. Decision grants and lifecycle completions remain deliberately separate; management HTTP authentication, history access, retention, and reconciliation remain unresolved.
