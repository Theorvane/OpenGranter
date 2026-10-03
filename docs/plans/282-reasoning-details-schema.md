# Track reasoning-detail response schema drift

## Issue and problem

- Issue: [#282](https://github.com/Theorvane/OpenGranter/issues/282), release gate #116.
- Existing assistant/stream projections retain reasoning_details references but do not track the structures behind them.

## Scope and expected behavior

- Select exactly eight reasoningDefinitions: ChatReasoningDetails, ChatStreamReasoningDetails, ReasoningDetailUnion, ReasoningDetailSummary, ReasoningDetailEncrypted, ReasoningDetailText, ReasoningDetailServerToolCall and ReasoningFormat.
- Track array/reference, discriminator/union, variant properties/required lists, format enum/nullability/extensions, constraints and literal defaults. Ignore editorial annotations; reject malformed/missing sources and rehashed invalid exact maps.
- Preserve all version-14 selections and provenance; reject pin versions 1..14. No runtime, IAM, secret, usage or audit changes; selection does not implement reasoning details or server tools.

## Design

- Add a separate exact map in the existing projector and version-15 offline pin. Full selected ChatAssistantMessage and ChatStreamDelta already track parent property/reference/required changes; no duplicate parent projection is needed.
- Fresh fixed official source matches existing source hash and selected projection. The union includes four variants, including server-tool-call metadata; preserving that shape is not enabling server tools.
- Fact audit confirms eight definitions with no additional transitive references. No unresolved product choice, glossary change or ADR.
- Depends on [PR #277](https://github.com/Theorvane/OpenGranter/pull/277) and its schema-only chain. Rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/openrouter-schema-drift.md).

## TDD plan

- Assert referenced definitions are selected; initial projection omits the map.
- Cover wrapper/union/variant/format drift while parent references remain fixed, parent field required/reference changes, annotation stability, literal defaults, malformed sources and rehashed invalid exact maps.
- Add one exact map and matching version gate/pin. Prove the new projection without that map equals version 14.
- Run focused tests, npm run check and live compatibility:drift.

## Delivery

- PR records red/green, provenance and full checks.
- Rollback pairs pin/projector versions. Runtime JSON validation and complete response/history/stream/client compatibility remain open.
- Require CI and approval before merge.

## Verification evidence

- Red: referenced-definition selection failed because reasoningDefinitions was undefined.
- Green: all 94 schema tests pass, including six new cases covering transitive structures, unchanged-parent drift, annotations/literal defaults, malformed sources, parent fields and rehashed invalid maps.
- npm run check passes 1,088 tests with one existing optional PostgreSQL skip, strict types, lint, planning/link/contract/fixture checks and offline integrity. Live compatibility:drift passes.
- New projection minus reasoningDefinitions exactly equals version 14. Canonical source SHA-256 remains f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e.
- Rebase only this issue's commit after dependency approvals/merges and validate actual heads.
