# Track referenced finish-reason schema drift

## Issue and problem

- Issue: [#236](https://github.com/Theorvane/OpenGranter/issues/236), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- ChatStreamChoice.finish_reason is structurally pinned as a reference, but changing the referenced ChatFinishReasonEnum definition escapes comparison. Runtime finish-reason validation and safe error projection already exist.

## Scope and expected behavior

- Add ChatFinishReasonEnum to the existing exact selected definitions map. Retain enum/type/nullability, structural constraints and literal defaults while ignoring editorial annotations.
- Explicitly refresh reviewed provenance/hash/version 8 and reject stale versions or rehashed missing/extra/malformed maps. Verify all prior selected structures are unchanged.
- No runtime/API, IAM, secrets, limits, audit or accounting change; no new accepted reason, native mapping, instance validation or full response-conformance claim.

## Design

- Reuse the bounded structural projector and exact-map checks with one selected definition. Read the [official fixed-host OpenAPI](https://openrouter.ai/openapi.json), preserve the source hash and record the reviewed definition in the pin.
- Confirm references and current source with a read-only fact audit under the repository planning skills. No new domain terms or ADRs.
- Independent branch from main; do not include pending discovery/documentation/SDK tool changes. Update the schema contract, PRD, architecture, acceptance and compatibility inventory.

## TDD plan

- First regression supplies a changed ChatFinishReasonEnum while keeping the selected reference unchanged; expect the missing projection assertion to fail before implementation.
- Cover enum members, nullability/type, bounds/defaults, annotation-only changes, malformed source, rehashed exact-map failures and all stale versions 1..7.
- Add the one selection/version gate, refresh only after verifying previous selections, adjust fixtures and run focused schema tests, npm run check and live compatibility:drift.

## Delivery

- Issue/plan before implementation, meaningful red/green evidence, explicit source provenance and focused PR. Merge only after required CI and approval.
- Risk: structural tracking must not be confused with runtime support for upstream values or complete conformance. Source comparison never rewrites the pin automatically. Rollback must keep projector and pin versions paired.

## Validation evidence

- Red before implementation: the new referenced enum projection regression returned undefined rather than the expected definition. Green: all 58 schema-drift tests pass, including the five new finish-reason cases and stale-version rejection.
- npm run check passes with 1,052 tests passing and one existing skip, strict types, lint, planning/link/contract checks and offline schema integrity. This independent branch excludes pending discovery/SDK tool changes.
- npm run compatibility:drift passes against the official fixed host. Removing ChatFinishReasonEnum from the new projection reproduces the prior projection exactly; canonical source digest remains b02d61edfa13dd8f531f1d4429e62164fe28ddb6bb048aac64dca2f2b8bcfe66. git diff --check passes.
