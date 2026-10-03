# Preserve streaming native finish reasons

## Issue and problem

- Issue: [#266](https://github.com/Theorvane/OpenGranter/issues/266), release gate #116.
- Delegated text streaming drops the documented choice-level native_finish_reason.

## Scope and expected behavior

- Preserve supplied optional string/null on ordinary and terminal deltas and repeated-finish usage choices on both HTTP bases. Absence, empty strings and Unicode remain exact.
- Final usage carries only its actual event's native reason; never copy earlier metadata or manufacture metadata for an empty choice list. Incomplete usage remains unreported to clients.
- Malformed metadata fails safely with possibly-billed accounting. IAM, limits, required audit/ledger gates and canonical finish validation remain unchanged. No metadata in operational records or errors.
- Managed streaming, tools/rich deltas, new canonical reasons, nonstream normalization and native adapter synthesis are out of scope.

## Design

- Extend decoded events and the completed stream outcome with an optional nativeFinishReason scalar; validate at decoder and independent encoder boundaries, including incomplete usage.
- Project at choice scope, capture final metadata from the usage event, and hand it off only after existing usage/audit controls. Keep identity callbacks free of opaque metadata.
- The official overview documents string/null native reasons, but current official ChatStreamChoice and the pinned OpenRouter SDK omit them. Do not fabricate a source pin field or claim SDK retention. OpenAI SDK raw JSON retention is separately tested.
- No new domain decision or ADR. Read-only fact audit uses the repository grill-with-docs dependencies. No pending PR dependency.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/stream-native-finish-reason.md).

## TDD plan

- First decoder-to-client regression should fail because supplied native metadata is omitted.
- Cover optional scalars, content/refusal/finish chunks, complete/missing/partial/invalid usage, empty-choice usage, independent canonical validation, safe framing, final-event handoff, both HTTP bases, SDK retention/omission, denial/limits and required audit/ledger failures.
- Implement minimum typed projections and handoff; run focused tests and npm run check.

## Delivery

- Include red/green and full-check evidence in the PR; require CI and approval.
- No migration; rollback removes optional metadata. Source-schema/SDK gaps and release gate #116 remain open.

## Verification evidence

- Red: node --experimental-strip-types --test test/stream-native-finish-reason.test.ts reproduced dropped choice metadata (null became undefined), silent malformed metadata acceptance and an incorrect successful HTTP response for malformed first-event metadata. Socket verification was rerun with permitted local networking.
- Green: all 10 focused tests pass, including actual OpenAI/OpenRouter SDK socket comparisons, both public HTTP bases, independent encoder validation before incomplete-usage omission, final-event provenance and safe accounting/control gates.
- npm run check passes 1,057 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Preserve pending reasoning/service-tier fields alongside this choice metadata during integration. Full response-instance/source/SDK compatibility and release gate #116 remain open.
