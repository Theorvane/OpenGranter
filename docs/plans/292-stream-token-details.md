# Preserve final stream token usage details

## Issue and problem

- Issue: [#292](https://github.com/Theorvane/OpenGranter/issues/292); release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Delegated streaming strips the schema-selected token categories now supported in nonstream responses. Sequence usage copies are shallow; independent encoder validation and serialization reread aggregate counters.

## Scope and expected behavior

- Preserve the existing eight bounded prompt/completion categories from the actual final usage event, including null/empty/absent groups, zero counts and nullable completion counters. Omit malformed groups independently; ignore unknown keys and cost/server-tool payloads.
- Terminal-choice and empty-choice upstream usage share the same projection. Final client framing remains existing delegated framing, after ledger/outcome audit persistence. Never carry category values from content/terminal deltas or infer detail totals.
- Capture aggregate counters and nested groups once into immutable snapshots at sequence, trusted invocation outcome and independent encoder boundaries. Independent snapshots must preserve absent total counters rather than derive new totals. Existing upstream normalization may derive total from valid base counters; categories never participate.
- Complete valid aggregate counters remain required for a final usage frame. Missing/partial/invalid aggregates remain explicit in the ledger and yield no fabricated usage frame. Details alone never create usage. Authentication/IAM/Deny, limits, persistence, cancellation/backpressure and interruption audit remain shared.
- No new operational detail retention, charges, permissions, credentials, routes, native/direct/tool streams, billed cost or category ledger reporting.

## Design

- Extract the nonstream helper into a shared chat-usage module; retain existing nonstream behavior and call its aggregate-plus-detail normalizer from both decoder usage branches.
- Add a non-deriving usage snapshot for already normalized events/outcomes. It selects only base counters and bounded detail groups, so nested mutable values and unknown payloads cannot be retained/replayed. Keep upstream total derivation separate from projection.
- Sequence stores a deep snapshot; composition captures the completed usage before asynchronous accounting; encoder snapshots before validating/projecting complete counters.
- Reusing aggregate normalization unconditionally in the encoder would fabricate an omitted total. Spreading injected usage would retain unknown fields and mutable nested groups. Explicit non-deriving snapshots avoid both.
- No new domain term or costly irreversible trade-off requires an ADR. Unimplemented provider/category/cost semantics remain explicit.
- Update [stream contract](../../contracts/stream-token-details.md), nonstream usage/encoder/sequence contracts, PRD, architecture, acceptance and compatibility inventory. The existing version-15 pin selects shared ChatUsage inline detail fields; no pin refresh.

## TDD plan

- First public HTTP and actual SDK cases expect final detail groups on both chat bases and upstream usage shapes; expected red is absent detail groups.
- Add independent sequence mutation, encoder malformed groups/changing getters, no invented total, outcome mutation during persistence and exact null/empty/omission checks.
- Cover partial/invalid/detail-only aggregates, larger/overlapping categories, unknown payload exclusion, final metadata/no content replay, IAM/Deny/limits, selection/outcome audit and ledger failure, cancellation/interruption.
- Implement minimum shared snapshots/decoder/projection changes; run focused stream/nonstream suites, npm run check and git diff --check; record red/green evidence.

## Delivery

- Issue and plan before tests/code; authorized identity/AI/DCO commit; PR links the plan and test evidence. Review as sjungwon03-ai, require CI, merge as sjungwon03.
- Risk: deriving totals at an independent boundary, changing aggregate classification, retaining injected payloads, or allowing final frames before persistence. Public tests guard these. No migration; revert this bounded projection to roll back.
- Keep #116 open and do not claim complete external-client compatibility.

### Verification evidence

- Red: `node --experimental-strip-types --test test/stream-token-details.test.ts` passed three cases and failed seven expected cases for dropped categories, shallow sequence mutation/unknown retention, aggregate getter re-reads and outcome mutation during persistence.
- Additional focused red cases reproduced a twice-read completed usage accessor and an unfrozen invalid-container snapshot. Both were corrected without changing aggregate classifications or fabricating totals.
- Green: stream-token-details, compatible-completion-usage, client encoder, chunk decoder, sequence, delegated composition and HTTP suites passed all 120 cases. Existing non-enumerable service-tier getter coverage caught an intermediate clone regression; the final explicit known-field outcome snapshot preserves that contract with one capture.
- `npm run format` formatted only this issue's changed TypeScript. Final `npm run check` passed 1,368 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and unchanged pinned-schema integrity. Both SDKs ran on both actual socket bases and final upstream usage shapes.
- Cancellation before/after accounting retains exactly one failed/succeeded attempt respectively; invalid/missing counters never gain invented total/category charges. Detail categories and unknown payloads remain outside audit/ledger records. #116 stays open.
