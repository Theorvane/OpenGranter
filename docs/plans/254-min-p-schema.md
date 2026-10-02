# Track min-p request schema drift

## Issue and problem

- Issue: [#254](https://github.com/Theorvane/OpenGranter/issues/254), release gate #116 and runtime request work #252.
- The selected request projection omits min_p, so upstream structural changes currently pass unnoticed.

## Scope and expected behavior

- Add optional nullable min_p as the nineteenth request field; preserve every version-10 selection.
- Track types, format, future constraints and literal defaults while ignoring annotations. Reject missing/malformed fields, rehashed invalid maps and versions 1..10.
- No runtime API, provider capability, IAM, secret, usage or audit changes. Source selection does not imply complete compatibility.

## Design

- Reuse the structural projector and explicitly refresh a version-11 pin from the fixed official source. Its current min_p shape has number/null type and double format, without encoded bounds or default.
- Avoid adding documented runtime bounds to the upstream snapshot: the guard records source facts.
- Read-only fact audit confirms the field and preserved selections. No unresolved product decision, new glossary term or ADR.
- Depends on [PR #245](https://github.com/Theorvane/OpenGranter/pull/245) and its #243/#237 chain; rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/openrouter-schema-drift.md).

## TDD plan

- Assert the exact selected min_p structure first; expect undefined before implementation.
- Cover structural drift, annotation stability, literal default preservation, missing/malformed sources and rehashed missing/extra/malformed fields.
- Add one selection and the matching version gate/pin; compare all previous projections explicitly.
- Run focused schema tests, npm run check and live compatibility:drift.

## Delivery

- Record red/green evidence, checks and provenance in the linked PR.
- Risk: source tracking does not validate runtime instances or native-provider support. Rollback pairs pin and projector versions.
- Require CI and approval before merge.

## Verification evidence

- Red: node --experimental-strip-types --test --test-name-pattern='min_p selection' test/openrouter-schema-drift.test.ts failed with undefined instead of the selected nullable number structure.
- Green: 73 focused schema tests pass. npm run check passes 1,067 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline integrity.
- Live compatibility:drift passes. Explicit refresh preserves every version-10 selection and official canonical source SHA-256 b02d61edfa13dd8f531f1d4429e62164fe28ddb6bb048aac64dca2f2b8bcfe66.
- Dependencies remain approval-gated; rebase only this issue's commit and revalidate after their merge.
