# Track top-a request schema drift

## Issue and problem

- Issue: [#258](https://github.com/Theorvane/OpenGranter/issues/258), release gate #116 and runtime request work #256.
- The selected request projection omits top_a, so upstream structural changes currently pass unnoticed.

## Scope and expected behavior

- Add optional nullable top_a as the twentieth request field; preserve every version-11 selection.
- Track types, format, future constraints and literal defaults while ignoring annotations. Reject missing/malformed fields, rehashed invalid maps and versions 1..11.
- No runtime API, provider capability, IAM, secret, usage or audit changes. Source selection does not imply complete compatibility.

## Design

- Reuse the structural projector and explicitly refresh a version-12 pin from the fixed official source. Its current top_a shape has number/null type and double format, without encoded bounds or default.
- Avoid adding documented runtime bounds to the upstream snapshot: the guard records source facts.
- Read-only fact audit confirms the field and preserved selections. No unresolved product decision, new glossary term or ADR.
- Depends on [PR #255](https://github.com/Theorvane/OpenGranter/pull/255) and its #245/#243/#237 chain; rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/openrouter-schema-drift.md).

## TDD plan

- Assert the exact selected top_a structure first; expect undefined before implementation.
- Cover structural drift, annotation stability, literal default preservation, missing/malformed sources and rehashed missing/extra/malformed fields.
- Add one selection and the matching version gate/pin; compare all previous projections explicitly.
- Run focused schema tests, npm run check and live compatibility:drift.

## Delivery

- Record red/green evidence, checks and provenance in the linked PR.
- Risk: source tracking does not validate runtime instances or native-provider support. Rollback pairs pin and projector versions.
- Require CI and approval before merge.

## Source provenance review

- The fresh official canonical source digest is f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e, changed from the version-11 source digest b02d61edfa13dd8f531f1d4429e62164fe28ddb6bb048aac64dca2f2b8bcfe66.
- The initial equality guard stopped the refresh. Direct comparison and an independent read-only fact audit then confirmed old and fresh selected projections are identical, including top_a. Every version-11 selection remains exactly unchanged after adding top_a.
- Source changes are outside selected coverage: legacy nullable flags/unrelated query parameters, container domain validation, observability cache-write-token options, speech/transcription privacy options, intern chat metadata, app-header SDK naming and Responses alias deprecation. No selected chat operation/definition or usage structure changes.
- Refresh provenance explicitly; do not expand the selection to these unrelated surfaces or certify runtime support for them.

## Verification evidence

- Red: node --experimental-strip-types --test --test-name-pattern='top_a selection' test/openrouter-schema-drift.test.ts failed with undefined instead of the selected nullable number structure.
- Green: 78 focused schema tests pass. npm run check passes 1,072 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline integrity.
- Live compatibility:drift passes. New projection minus top_a exactly equals version 11; reviewed source provenance is recorded above.
- Dependencies remain approval-gated. Rebase only this issue's commit and revalidate after their merge.
