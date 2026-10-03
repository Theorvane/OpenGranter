# Track reasoning-effort request schema drift

## Issue and problem

- Issue: [#276](https://github.com/Theorvane/OpenGranter/issues/276), release gate #116 and runtime request work #274.
- The selected request projection omits reasoning_effort, so upstream structural changes pass unnoticed.

## Scope and expected behavior

- Add optional nullable reasoning_effort as the twenty-second request field; preserve every version-13 selection.
- Track the seven string enum values plus null, types, unknown-value extension, required status and literal defaults while ignoring annotations. Reject missing/malformed fields, invalid rehashed maps and versions 1..13.
- No runtime, provider capability, IAM, secret, usage or audit changes; structured reasoning remains unsupported by this work.

## Design

- Reuse the structural projector and refresh a version-14 pin from the fixed official source. The field is inline with no default or additional referenced definition.
- Read-only fact audit confirms the existing projection and official source digest are unchanged. No unresolved product decision, new glossary term or ADR.
- Depends on [PR #263](https://github.com/Theorvane/OpenGranter/pull/263) and its #259/#255/#245/#243/#237 chain; rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/openrouter-schema-drift.md).

## TDD plan

- Assert exact selected reasoning_effort structure first; expect undefined before implementation.
- Cover enum/type/null/default/extension/required drift, annotation stability, literal defaults, missing/malformed sources and rehashed invalid fields.
- Add one selection and matching version/pin; compare all previous projections explicitly.
- Run focused schema tests, npm run check and live compatibility:drift.

## Delivery

- Include red/green, checks and provenance in the linked PR.
- Risk: source tracking does not validate runtime instances or native support. Rollback pairs pin and projector versions.
- Require CI and approval before merge.

## Verification evidence

- Red: focused reasoning_effort selection test failed because the projected field was undefined.
- Green: all 88 schema tests pass. npm run check passes 1,082 tests with one existing optional PostgreSQL skip, strict types, lint, planning/link/contract/fixture checks and offline integrity.
- Live compatibility:drift passes. New projection minus reasoning_effort exactly equals version 13; source SHA-256 remains f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e.
- Dependencies remain approval-gated; rebase only this issue's commit and revalidate after merge.
