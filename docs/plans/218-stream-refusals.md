# Preserve delegated streaming refusals

## Issue and problem

- Issue: [#218](https://github.com/Theorvane/OpenGranter/issues/218); release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The decoder rejects every delta.refusal despite the optional string/null field already selected in the official ChatStreamDelta pin. Valid filtered/refusal streams fail rather than deliver compatible results.

## Scope and expected behavior

- Preserve exact optional string/null refusal on assistant/text/terminal deltas, including empty/Unicode/newline values and content_filter termination. Omission stays omission; do not fabricate text or synthesize a refusal signal.
- Valid refusal streams remain successful deliveries with no fallback/replay. Existing IAM, limits, cancellation, backpressure, required attempt usage and outcome audit precede final usage/DONE.
- Validate malformed refusal values with existing safe JSON/SSE first/later failures and possible-billing accounting. Refusal text stays out of logs, audit, ledger metadata and errors.
- Usage-only events allow absent/null/empty refusal but reject substantive refusal text, matching the existing content-free usage boundary rather than silently discarding it. Synthesized usage does not repeat previous refusal.
- No direct/tool/multimodal/reasoning streams, complete conformance or response content aggregation.

## Design

- Add optional refusal to the normalized delta and allowlist/type validation, plus independent encoder validation/JSON projection. Sequence state, complete outcomes and accounting are unchanged; no retained refusal transcript.
- Rejecting nonempty refusal in final usage avoids silent content loss; ordinary separate refusal deltas remain supported. No new domain terms or irreversible design decisions/ADR.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02; the current pin already selects optional string/null refusal, so no pin expansion or refresh is needed.
- See [contract](../../contracts/stream-refusals.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md). Fingerprint PR #217 remains independent/approval-pending; integrate if approved. Other stream/schema/client release gaps remain explicit.

## TDD plan

- First failing regressions: decode/encode string/null refusal deltas and an actual native HTTP stream on both prefixes. Expect current invalid-chunk/502 failure instead of successful refusal delivery.
- Cover omission/empty/Unicode/framing text, ordinary content parity, content_filter finish, malformed first/later values, usage-only substantive refusal rejection, complete/unknown usage, both SDK socket bases and required persistence/denial/limit gates.
- Minimal decoder/encoder changes only; use npm run format and npm run check, including existing source-pin integrity. Tests through public boundaries preserve accounting and safe metadata projection.

## Delivery

- Issue and plan before code; new branch and PR with red/green evidence and full verification. Merge only after successful CI and approval.
- Risk: refusal is provider response content, not a gateway denial or authorization authority. Missing usage stays unknown; do not replay a successfully delivered refusal. Other response types and full external-client compatibility remain open.

## Validation evidence

- Red: two public regressions failed before coding. The native HTTP stream returned 502 instead of 200; decoder/encoder refusal regression threw Invalid OpenRouter stream chunk. Command: node --experimental-strip-types --test --test-name-pattern='stream refusal|native refusal' test/openrouter-stream-chunks.test.ts test/delegated-http-stream.test.ts.
- Green: focused refusal success and usage-only rejection tests passed after the minimal decoder/encoder change. Additional tests cover malformed first/later values, independent encoder validation, content coexistence, safe framing, denial/limit boundaries and required usage/audit failures.
- npm run check passed: 1,015 passing tests and one existing skip, strict types, lint, planning/link/secret checks and offline pin integrity. Four actual installed-SDK socket cases cover both bases with complete or missing final usage and include_usage:false.
- No source pin changed; the current reviewed ChatStreamDelta already selects string/null refusal. #217 has successful CI but still requires approval, so this branch starts from merged main independently.
