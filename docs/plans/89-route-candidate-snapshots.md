# Retain evaluated route candidate snapshots

## Issue and problem

- Issue: [#89](https://github.com/Theorvane/OpenGranter/issues/89).
- `authorizeCandidates` returns caller-owned object references. A trusted configuration update during asynchronous limit/selection/audit work can change already evaluated destinations and their audit attribution.

## Scope and expected behavior

- Project known candidate fields into immutable copies before provider evaluation; return an immutable result/array. Do not retain source object/array references or unrelated runtime fields.
- Selection, managed fallback/inference, delegated mapping, and audit retain the evaluated candidate values across callbacks.
- Keep model/provider Allow/Deny semantics, candidate order, route-kind filtering, and empty results unchanged.
- This is an in-process snapshot fix, not a new configuration reload or concurrent DB transaction guarantee. No new routes, IAM actions, request fields, schema, or public endpoint.

## Design

- Reuse the pure authorization boundary as the shared copy/freeze point for all route consumers. Project only ID, kind, upstream model ID, and provider ID.
- Freeze each projected object, the filtered array, and the result. Creating the snapshot before evaluating its provider ensures the evaluated and returned fields agree.
- Keep original caller objects mutable; later updates affect a new authorization call only. Callbacks attempting to mutate the returned snapshot receive standard frozen-object behavior; existing callback-exception handling remains unchanged.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [snapshot contract](../../contracts/route-candidate-snapshots.md).

## TDD plan

- Reproduce source object mutation after authorization with a failing regression assertion that the evaluated candidate remains unchanged.
- Cover immutable projected fields/array and stripped extras, async selector source mutation, managed limit/fallback source mutation, delegated mapping callback source mutation, and preserved Deny/kind/order behavior.
- Make the smallest shared defensive snapshot implementation. Run focused regression/route tests, format, and `npm run check`.

## Delivery

- Issue/plan precede coding; record actual failing regression results and green evidence in a ready PR.
- The change adds object/array copies and freezes per authorization call. Consumers must treat the returned candidates as readonly, as already declared by TypeScript.
- Rollback restores caller-reference behavior; no data migration is involved. Report callback mutation behavior and unchanged external error contracts.

## Verification evidence

- Red: `node --experimental-strip-types test/route-candidate-snapshots.test.ts` reproduced five failures, with the unchanged Deny/order/kind case passing.
- Green: regression/route-contract/selector/ordered/Jev/delegated suites passed all 46 cases after the shared copy/freeze implementation.
- Initial `npm run check` passed strict TypeScript, Biome, 327 tests, and planning/link/contract/fixture checks. One external PostgreSQL case was skipped locally without a DB URL; CI provides PostgreSQL. Embedded PostgreSQL cases passed.
- `git diff --check` passed; no schema change; `CLAUDE.md` symlink preserved.

### Integration after runtime review

PR #88 became approved and was merged to main during implementation. Integrated its owned dual runtime and preserved both additive documentation sections. The combined `npm run check` passed strict TypeScript, Biome, 338 tests, and planning/link/contract/fixture checks; the same external PostgreSQL case remained locally skipped. Candidate authorization production code was unchanged during integration.
