# OpenRouter text-stream sequence validation

## Issue and problem

- Issue: [#192](https://github.com/Theorvane/OpenGranter/issues/192).
- Valid individual SSE payloads can still form an invalid model response when generation identities change, terminal events repeat, usage arrives early or twice, or `[DONE]` never arrives.

## Scope and expected behavior

- Add a pure state validator over the already decoded text-only OpenRouter events. Require stable id/model, at most one terminal reason, usage after terminal, matching repeated finish reason when present, and one final `[DONE]`.
- A first-event or midstream upstream error produces a distinct failed outcome with possible billing. Invalid or truncated sequences raise a fixed safe failure with possible billing. Preserve normalized usage and explicit missing/invalid values in a successful summary.
- Keep response content out of retained state. This issue does not fetch upstream data, write client SSE, persist usage/audit, or enable `stream:true`.

## Design

- A small synchronous state machine accepts validated tagged events and returns an immutable outcome only after finalization. It stores id, client model alias, finish reason, and a snapshot of usage; it does not store deltas.
- Permit a usage event with no finish reason for the empty-choice compatibility variant; match it to the terminal reason when one is present. Reject all events after done or failed.
- Treat EOF/cancellation before done as uncertain failure rather than successful completion. This does not assert that upstream cancellation prevents provider billing.
- See [sequence contract](../../contracts/openrouter-stream-sequence.md), [chunk contract](../../contracts/openrouter-stream-chunks.md), [compatibility inventory](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- First add public state-machine tests for documented terminal/usage/done sequence and capture the missing-module red result.
- Add empty-choice usage, identity mismatch, duplicate/out-of-order events, error-first/midstream, truncated, post-done and snapshot tests.
- Implement the smallest fixed-error state machine; run focused tests and `npm run check`.

## Delivery

- Issue and plan; red; implementation and contract; green/full checks; ready PR.
- Risk: provider streams may have additional variants. The validator remains internal and text-only until end-to-end provider/client conformance and accounting are complete.
- PR evidence: red/green, full gate and remaining integration work.
