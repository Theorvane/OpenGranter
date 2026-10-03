# Preserve delegated stream reasoning details

## Issue and problem

- Issue: [#286](https://github.com/Theorvane/OpenGranter/issues/286), release gate #116.
- The delegated stream delta allowlist rejects official reasoning_details arrays.

## Scope and expected behavior

- Preserve each validated summary/text/encrypted array, including empty arrays and omitted fields, in frame and item order. Do not merge indices, concatenate strings or decrypt/reconstruct payloads.
- Reuse the exact immutable nonstream subset. Reject malformed/unknown/server-tool-call details with safe possibly-billed failure accounting.
- Any supplied detail field on usage-only events rejects, including empty arrays and incomplete usage, as an explicit local content-free-frame restriction. Never silently discard it or fabricate usage.
- Preserve IAM/Deny/limits, required audit/ledger, cancellation, backpressure and interruption metadata. Keep details outside accounting outcomes and operational records/errors.
- No direct/tool streams, server tools, assembled reasoning history or native thinking mappings.

## Design

- Add optional reasoningDetails only to typed delta events, validate/copy at the decoder and public SSE encoder, and emit reasoning_details in JSON frames.
- Official stream/nonstream wrappers share the same union. The reasoning guide describes concatenating chunk sequences in order, without specifying per-index/string reconstruction. Forward frame/item order; do not claim assembled history.
- Final usage delta is content-free; reject any detail field before incomplete-usage early returns. No new glossary/ADR or unresolved domain choice.
- Depends on [PR #239](https://github.com/Theorvane/OpenGranter/pull/239) and [PR #285](https://github.com/Theorvane/OpenGranter/pull/285), including #241. Rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/stream-reasoning-details.md).

## TDD plan

- Initial public stream returns 502 instead of streaming valid details; initial decoder rejects the new field.
- Cover payload/metadata/empty/omission preservation, malformed first/later frames, usage-only rejection with complete/missing counts, encoder bypass validation, IAM/provider Deny/limits and required persistence, actual SDK sockets and no operational content retention.
- Extend decoder/encoder only; run focused tests and npm run check, then integrate prior metadata/sampling changes.

## Delivery

- Report red/green, checks, dependency and remaining compatibility limits in the PR.
- Rollback restores unsupported delta rejection. Require CI and approval; actual rebased heads need validation.

## Validation evidence

- Red: valid public HTTP details initially returned 502; recorded in /private/tmp/opengranter-286-red.log.
- Green: 23 focused decoder/encoder/HTTP cases passed, including nine new tests and both official SDKs on both prefixes. The formerly unsupported valid-detail fixture now uses an unsupported server-tool-call item. Explicit model/provider Deny overrides also pass.
- npm run check: 1,092 passing tests, one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline schema integrity. Subsequent denial-test extension passed focused tests and strict type/lint checks.
- Approval and green required CI remain required. Temporary composition testing does not certify actual rebased heads or full external-client compatibility.

## Merge integration validation

Preserve scalar reasoning and its issue-238 independent usage-encoder correction, tier, fingerprint and native choice metadata while integrating detail deltas. Add a combined public decoder/encoder regression before resolving production conflicts; record red on the prior encoder, then retain immutable detail validation and usage-only detail rejection before incomplete-counter returns. Verify all earlier stream metadata controls and focused/full green.

Red on prior encoder: combined detail/scalar/tier/fingerprint/native metadata regression failed because reasoning_details was omitted (0 passed, 1 failed). Green after preserving immutable details alongside all earlier scalar and metadata validation: all 40 focused detail/chunk/native cases pass. Any own usage-only detail field rejects before incomplete counters, while the issue-238 substantive/malformed reasoning regression remains green. Full final validation and required CI are reported in the PR.
