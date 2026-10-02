# Accept bounded delegated stream usage options

## Issue and problem

- Issue: [#214](https://github.com/Theorvane/OpenGranter/issues/214).
- SDK clients sending stream_options.include_usage currently get invalid_request on delegated streams. The official schema marks include_usage deprecated with no effect; OpenRouter always includes full final usage when available.

## Scope and expected behavior

- Both chat bases accept omitted/null options and exact stream:true option objects: {}, include_usage:true or include_usage:false. Reject unknown keys, malformed values and non-null options on non-streaming requests before routing/inference. Null is omission.
- Freeze recognized option values before asynchronous routing and again at the native delegated boundary before secret resolution. Forward only that bounded object on a streaming request; omission/null adds no field.
- include_usage does not suppress final usage, validation, ledger, IAM, limits, audit or interruption handling. Missing usage remains unknown and is never fabricated. Direct/tool/multimodal streams remain unsupported.
- Select the official ChatRequest.stream_options reference in the structural drift pin, retaining nested ChatStreamOptions type and deprecated marker. Explicitly regenerate version 6 with provenance/hash.

## Design

- Reuse a pure snapshotStreamOptions validator in HTTP and OpenRouter request preparation. Existing stream finalization is unchanged, so false cannot disable accounting or alter terminal ordering.
- Non-null options require streaming at both boundaries; this is an explicit bounded local restriction. A valid ignored include_usage value remains serialized for compatible SDK/native requests without becoming an accounting authority.
- Official [OpenAPI](https://openrouter.ai/openapi.json) checked 2026-10-02 says include_usage has no effect. The [streaming guide](https://openrouter.ai/docs/api_reference/streaming) describes the unconditional final usage frame. See [contract](../../contracts/stream-usage-options.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md).
- No new domain term or ADR. Open dependencies: missing final usage, other option fields, direct/tool streams, full schema/client conformance and named external-tool workflows.

## TDD plan

- First add both-prefix streamed option variants and expect the current boundary's 400 instead of 200.
- Add malformed/nonstream rejection before routing/secrets, native frozen capture during secret await, SDK serialization, false-option denial/limit and persistence failure parity, and unknown final usage cases.
- First drift tests select stream_options and mutate its reference or nested include_usage type/deprecation; expect failure before projector expansion. Retain stale-pin and selected-field exact-map tests.
- Implement minimal snapshot/forwarding and selected field changes, explicitly refresh the pin, format and run npm run check plus live drift comparison.

## Delivery

- Issue/plan/contract first, red/green evidence and reviewable PR. Integrate approved #213 prerequisite before targeting main.
- Risks: false does not request OpenAI-style usage suppression; this follows the OpenRouter API contract on both aliases. Do not invent unavailable provider usage or claim full compatibility.

Version 6 adds the selected ChatRequest.stream_options reference. The 2026-10-02 source also adds ChatDynamicServerTool to ChatFunctionTool.anyOf; this reviewed source alternative remains outside the bounded local function-tool subset and is rejected. All other previously selected structures remain unchanged. This pin refresh does not enable dynamic or server tools.

## Validation evidence

- Red: both-prefix nullable-option regression returned 400 instead of 200; request-field projection returned undefined instead of the ChatStreamOptions reference. Both failures were observed before implementation.
- Green: npm run check passed with 1,007 tests passing and one pre-existing skip, strict type checking, lint, planning/link/secret checks and offline pin integrity. SDK serialization ran over a real local socket. False-option IAM/limit/upstream/ledger/audit failures and missing-usage behavior remain covered. Native options are captured before credential awaits and malformed/nonstream options reject before secret access.
- npm run compatibility:drift passed against the current official fixed-host schema. PR #213 merged with approval and successful CI before delivery of this follow-up.
