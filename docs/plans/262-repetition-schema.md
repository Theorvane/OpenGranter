# Track repetition-penalty request schema drift

## Issue and problem

- Issue: [#262](https://github.com/Theorvane/OpenGranter/issues/262), release gate #116 and runtime request work #260.
- The selected request projection omits repetition_penalty, so upstream structural changes currently pass unnoticed.

## Scope and expected behavior

- Add optional nullable repetition_penalty as the twenty-first request field; preserve every version-12 selection.
- Track types, format, future constraints and literal defaults while ignoring annotations. Reject missing/malformed fields, rehashed invalid maps and versions 1..12.
- No runtime API, provider capability, IAM, secret, usage or audit changes. Source selection does not imply complete compatibility.

## Design

- Reuse the structural projector and explicitly refresh a version-13 pin from the fixed official source. Its current repetition_penalty shape has number/null type and double format, without encoded bounds or default.
- Avoid adding documented runtime bounds to the upstream snapshot: the guard records source facts.
- Read-only fact audit confirms the field and preserved selections. No unresolved product decision, new glossary term or ADR.
- Depends on [PR #259](https://github.com/Theorvane/OpenGranter/pull/259) and its #255/#245/#243/#237 chain; rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/openrouter-schema-drift.md).

## TDD plan

- Assert the exact selected repetition_penalty structure first; expect undefined before implementation.
- Cover structural drift, annotation stability, literal default preservation, missing/malformed sources and rehashed missing/extra/malformed fields.
- Add one selection and the matching version gate/pin; compare all previous projections explicitly.
- Run focused schema tests, npm run check and live compatibility:drift.

## Delivery

- Record red/green evidence, checks and provenance in the linked PR.
- Risk: source tracking does not validate runtime instances or native-provider support. Rollback pairs pin and projector versions.
- Require CI and approval before merge.

## Verification evidence

- Red: node --experimental-strip-types --test --test-name-pattern='repetition_penalty selection' test/openrouter-schema-drift.test.ts failed with undefined instead of the selected nullable number structure.
- Green: 83 focused schema tests pass. npm run check passes 1,077 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline integrity.
- Live compatibility:drift passes. New projection minus repetition_penalty exactly equals version 12, preserving official source SHA-256 f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e.
- Dependencies remain approval-gated; rebase only this issue's commit and revalidate after their merge.
