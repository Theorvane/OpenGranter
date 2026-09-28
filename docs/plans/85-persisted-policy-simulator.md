# Persisted principal policy simulation

## Issue and problem

- Issue: [#85](https://github.com/Theorvane/OpenGranter/issues/85).
- The acceptance contract requires policy simulation and live gateway IAM to agree. Consistent attachment storage and pure evaluation exist but lack an internal persisted simulation boundary.

## Scope and expected behavior

- Add `createPostgresPolicySimulator(client)` returning an internal `simulate({ principalId, action, resource })` function.
- Read one current principal/direct-policy/role-policy snapshot per call and reuse `evaluateAttachments`. Return only effect, reason, and evaluated policy IDs/versions; missing principals return `undefined`.
- Default Deny, explicit Deny, inactive state, and attachment completeness retain existing evaluator/reader semantics. Changes affect the next simulation without caching.
- Validate principal IDs (nonempty, at most 256 characters) and action/resources (nonempty, at most 512 characters) before SQL. Ignore caller policy/state fields.
- This is a trusted internal diagnostic, not authentication or permission to invoke a model. The caller restricts access; no public endpoint or administrative reader policy is decided.
- No mutation, simulation audit/usage write, catalog/credential/limit evaluation, hypothetical policy editing, new action, schema, or SSO implementation.

## Design

- Compose the single-statement PostgreSQL identity snapshot reader with the existing pure attachment evaluator. Explicitly project the principal/action/resource inputs into the evaluator.
- Use existing decision reasons and policy version attribution; do not duplicate matching logic or return statements. Malformed/incomplete/unavailable snapshots produce fixed simulator availability errors.
- One snapshot is consistent at its read, with no cross-operation cache or guarantee against later concurrent changes. Simulation does not guarantee end-to-end invocation success.
- Public simulator authentication, target visibility, read audit, and management UI remain open. Existing trusted application code can use this boundary without settling them.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [simulator contract](../../contracts/persisted-policy-simulator.md).

## TDD plan

- First persisted role-grant simulation test imports the absent module; expect module-not-found before implementation.
- Cover direct/inherited Allow/Deny, wildcard/mismatched action/resource, policy version/attachment/active changes between calls, missing principals, ignored forged fields, malformed/incomplete snapshots, safe driver failure, and invalid bounded inputs before SQL.
- Compare model/provider simulation results against actual PostgreSQL gateway HTTP authorization with issued tokens and fake inference; assert simulation changes no audit/usage/credential data.
- Implement only validation, fresh snapshot reading, and pure evaluator composition. Format, run focused tests, then `npm run check`.

## Delivery

- Issue and plan precede coding. Record red/green and full-check evidence in a ready PR.
- Rollback removes the unused internal facade; no schema or stored data changes.
- Report internal access responsibility, IAM-only scope, timing limits, and unchanged public API decisions.

## Verification evidence

- Red: `node --experimental-strip-types test/postgres-policy-simulator.test.ts` failed with `ERR_MODULE_NOT_FOUND` before implementation.
- Green: the same command passed all 5 integration/boundary tests.
- Initial `npm run check` passed strict TypeScript, Biome, 317 tests, and planning/link/contract/fixture checks. One external PostgreSQL test was skipped locally without a database URL; CI supplies PostgreSQL. Embedded PostgreSQL cases passed.
- `git diff --check` passed. No schema change; `CLAUDE.md` remains a symlink to `AGENTS.md`.

### Integration after dual-route review

PR #84 became approved during implementation and was merged to main. Integrated its dual-route handler/server and retained both additive documentation sections. The combined `npm run check` passed strict TypeScript, Biome, 321 tests, and planning/link/contract/fixture checks; the same external PostgreSQL case remained locally skipped. No simulator behavior changed during integration.
