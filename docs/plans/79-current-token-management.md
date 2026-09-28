# Current actor policies for token management

## Issue and problem

- Issue: [#79](https://github.com/Theorvane/OpenGranter/issues/79).
- The internal PostgreSQL coordinator accepts a resolved actor snapshot. Deployment callers must assemble that snapshot and may accidentally retain stale grants between operations.

## Scope and expected behavior

- Add an internal PostgreSQL service taking `authenticatedActorId`, request ID, and operation fields. The caller must derive the actor ID from trusted prior authentication, never an untrusted request body.
- Load the current principal, direct policies, and role policies on every issue/revoke call. Pass only the validated snapshot into the existing IAM coordinator.
- Missing and inactive actors deny with required decision audit and empty evaluated policy versions. Active actors without attachments default deny. Explicit Deny overrides Allow.
- Snapshot or decision-write failures stop mutation with fixed errors. Invalid IDs/expiry reject before SQL. Token bodies/digests and policy statements remain outside decisions.
- No authentication, SSO, HTTP management endpoint, schema change, maximum lifetime, target existence validation, or new IAM action.

## Design

- Compose the existing single-statement identity reader, attachment resolver, persisted coordinator, and credential service. Build operation arguments explicitly; ignore any extra caller actor/policy fields.
- Keep the lower-level resolved-actor coordinator available. Reusing it preserves owner-scoped revocation, required decision audit, and atomic credential lifecycle writes.
- Each operation uses one consistent actor snapshot; concurrent policy changes after the read are not revalidated or transactionally locked. A recorded grant indicates authorization, not successful mutation.
- Open decisions remain SSO protocol, authenticated public management contract, maximum lifetime, and policy-write/version-history API.
- Updated contracts: [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [internal service contract](../../contracts/token-management.md).

## TDD plan

- First integration test imports the new service and exercises persisted role-policy issue/revoke; expect module-not-found before implementation.
- Cover direct/inherited Deny precedence, policy version and attachment changes between calls, default Deny, inactive/missing actors, forged caller actor fields, owner-scope mismatch, malformed/unavailable snapshots, required audit failure, and invalid input before SQL.
- Implement only fresh lookup, argument validation/projection, and composition of existing boundaries.
- Run focused Node tests, Biome formatting, then `npm run check`.

## Delivery

- Record issue and plan; add acceptance/contract scenarios; run red tests; implement and run green; validate the repository; open a ready PR.
- Rollback removes the new internal facade; no schema/data rollback is necessary. Existing resolved-actor callers remain responsible for fresh snapshots.
- Report exact red/green commands and results, full validation, and trusted caller/concurrent update limitations in the PR.

## Verification evidence

- Red: `node --experimental-strip-types test/postgres-token-management-service.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the unimplemented service.
- Green: the same command passed all 7 focused integration/boundary tests.
- `npm run check` passed TypeScript strict checking, Biome, 306 tests, and the planning/link/contract/fixture checker. One real PostgreSQL test was skipped locally because no external database URL was configured; CI supplies its PostgreSQL service. Embedded PostgreSQL tests passed.
- `git diff --check` passed; `CLAUDE.md` remains a symlink to `AGENTS.md`.
