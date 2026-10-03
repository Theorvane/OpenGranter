# Track non-streaming response schema drift

## Issue and problem

- Issue: [#242](https://github.com/Theorvane/OpenGranter/issues/242), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The selected drift pin lacks the successful non-streaming response reference and ChatResult/ChatChoice/ChatAssistantMessage structures, allowing required-field, fingerprint and reasoning changes to escape detection.

## Scope and expected behavior

- Select the fixed /chat/completions HTTP 200 application/json responseRef and an exact three-entry responseDefinitions map. Track structural properties, required lists, references, nullability, constraints and literal defaults; ignore editorial annotations.
- Explicitly refresh provenance/version 9 after verifying all prior projections unchanged. Reject missing/malformed path/definitions, rehashed missing/extra/malformed maps and stale versions 1..8.
- No runtime/client/provider behavior, IAM/limits/secrets/audit/accounting change. No recursive usage/rich-definition traversal, JSON-instance validation or complete compatibility claim.

## Design

- Reuse the bounded structural projector. Require the official ChatResult reference; project whole selected definitions without inferring supported runtime capabilities from their wider schema.
- Source: [official fixed-host OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02. A read-only fact audit confirms ChatResult/ChatChoice/ChatAssistantMessage and existing tests needing updates when formerly unselected assistant properties become selected.
- Depends on [#237](https://github.com/Theorvane/OpenGranter/pull/237), version-8 shared finish-reason selection. Start from main, locally include that dependency and rebase only this issue's commit after #237 merges. No new domain terms or ADRs.

## TDD plan

- First regression asserts the selected response reference/definitions and fails before projector changes. Record the expected undefined projection failure.
- Cover required/type/nullable/reference/constraint/default changes, annotation-only stability, malformed response paths/definitions, exact-map rehash failures and stale pins. Preserve unaffected selections.
- Update source fixtures to include selected response paths/definitions. Assistant content changes now cause drift; unrelated instruction-message content stays ignored. Implement minimum selection/version gate, explicitly refresh the pin, format and run focused tests, npm run check and live compatibility:drift.

## Delivery

- Issue/plan before code, updated schema contract/PRD/architecture/acceptance/compatibility and focused PR with red/green/provenance evidence. Merge dependency first, then require CI and approval.
- Risks: selecting wider response shapes must not imply those shapes work at runtime. Referenced ChatUsage, audio/images/reasoning-detail definitions remain untraversed. Compare source without automatically rewriting the pin. Rollback pairs projector and pin versions.

## Verification evidence

- Red: the response projection regression failed because responseRef was undefined before the projector change.
- Green: all 63 focused schema tests pass. npm run check passes 1,057 tests with one existing skip, strict types/lint, planning checks and offline integrity. Live compatibility:drift passes.
- The explicit version-9 refresh preserves every version-8 selection and the official canonical source SHA-256 b02d61edfa13dd8f531f1d4429e62164fe28ddb6bb048aac64dca2f2b8bcfe66.
- Dependency #237 still requires approval. Rebase only the issue-242 commit after its merge and validate the resulting tree before merging this PR.
