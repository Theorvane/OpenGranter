# Preserve delegated stream service tier metadata

## Issue and problem

- Issue: [#250](https://github.com/Theorvane/OpenGranter/issues/250), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Delegated text streaming drops optional official service_tier chunk/usage metadata, unlike the pending nonstream subset.

## Scope and expected behavior

- Preserve exact optional string/null/omission on decoded deltas, serialized client frames and actual final usage metadata through both chat bases.
- Capture/validate scalars once, independently validate encoder metadata and use the actual usage event tier for final frames. Never replay or infer an earlier tier. Incomplete usage still emits no fabricated frame.
- Malformed first/later upstream tiers retain safe failures, interruption audit and possibly-billed usage. No tier in operational audit/ledger/errors or callback identity.
- No client tier control, route/IAM/limit/cost changes or direct/tool/native stream support. Nonstream #249 remains independently approval-gated.

## Design

- Extend existing fingerprint-style optional scalar flow in decoder, encoder, sequence outcome and delegated final-usage composition; terminal identity remains only id/created/model.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02, and pinned SDK 1.4.18 ChatStreamChunk service_tier string/null schema. Repository-required read-only fact audit verifies the full metadata path and explicit accounting/audit extraction.
- Existing reviewed streamDefinitions projection already selects the complete ChatStreamChunk shape; no source pin change. Reuse strict framing and complete-usage gates rather than change event order/backpressure/cancellation.
- Alternative: carry forward a prior tier would invent metadata for an absent usage-event field. No new domain term, ADR or unresolved product decision.
- Update PRD, architecture, acceptance, compatibility and stream metadata contract.

## TDD plan

- First decode/encode regression fails because supplied service_tier disappears. Add minimum scalar flow, then expand tests.
- Verify delta/terminal/empty-choice and repeated-terminal usage forms, exact strings/null/omission and framing injection safety, malformed decoder/encoder input, final usage independence and missing-usage suppression.
- Public/actual SDK sockets cover both bases, safe first/later failures, metadata privacy, denial/limits and required ledger/outcome-audit failures. Preserve callback identity and accounting semantics.
- Format, run focused tests and npm run check; no inference network calls.

## Delivery

- Issue/plan before coding, PR linked plan and red/green/full validation; CI and approval before merge. No dependency on pending nonstream metadata PR.
- Risk: reported tier is untrusted response metadata and does not promise provider price or capability. Full streaming compatibility remains open. Rollback removes the scalar metadata flow.

## Verification evidence

- Red: decode/encode regression failed because service_tier was undefined instead of the supplied exact value. An additional regression reproduced the independent encoder silently suppressing malformed tier when usage was missing; it now rejects before suppression.
- Green: 49 focused streaming/sequence/composition/official-SDK tests pass (nine new cases). Values survive both bases, final metadata is independent, incomplete usage stays unknown and framing/private metadata remains safe.
- npm run check passes 1,056 tests with one existing skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity. All accounting/denial/failure tests remain green.
- Current reviewed ChatStreamChunk selection already contains service_tier; pin unchanged. Branch is independent of pending nonstream metadata changes.

## Merge integration validation

Preserve scalar reasoning, the issue-238 independent usage-encoder correction, fingerprints and native finish metadata while integrating tier capture. Add a public HTTP regression covering all metadata on both bases before resolving production conflicts, record red on the prior encoder/sequence, and rerun focused/full checks after retaining both fields and actual usage-event assignments.

Red on prior encoder/sequence: combined public HTTP metadata test failed because service_tier was omitted (0 passed, 1 failed). Green after preserving tier alongside reasoning/fingerprint/native finish: all 40 focused chunk/sequence/native-metadata cases pass. Full final-head checks and required CI are reported in the PR.
