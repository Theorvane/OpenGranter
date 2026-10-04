# Bounded managed Gemini function streams

Issue: #408. Plan: [408-gemini-function-streams](../docs/plans/408-gemini-function-streams.md).

## Request and authority

Registered native streamGenerateContent routes support custom client function SSE on /v1 and /api/v1 through the captured administrator-registration dispatcher and generated persisted direct/dual servers. The explicit google-function mode accepts the same bounded definitions, choices, history and signature-free thinking controls as [Gemini nonstream functions](gemini-client-functions.md). Google text-only mode remains closed to function controls/history. Unsupported strict:true, single-call controls beyond NONE and simultaneous explicit reasoning effort fail before keys. Function requests use thinkingBudget:0; models unable to disable thinking may fail natively, and signatures remain unsupported rather than silently discarded.

Serialize validated immutable controls and complete correlated result histories before secret resolution; use only the fixed registered host/model, output caps and administrator key reference. Preserve authentication, complete model/final-provider IAM and explicit Deny, limits, required usage/audit, safe cancellation and no replay. Gateway code never executes client tools. Native response IDs and call IDs are private protocol content, not authority or operational metadata.

## Native sequence and projection

Require initial exact registered modelVersion and nonempty bounded responseId. Later omitted identities retain that binding; conflicting supplied identities fail. Validate one candidate/index zero, model content role and supported fields. Each event is fully validated before role/text/call delivery. Plain text is projected in part order. Each native functionCall contains a complete optional JSON object args; omitted args becomes {}. Validate bounded plain objects, names and supported fields, then emit one full compatible call with its dense index. Preserve native IDs; missing IDs use the existing reserved gateway correlation IDs and omit native IDs on both call/result replay. Reject duplicate native IDs across events, unsupported partialArgs/willContinue, thought/signature/rich fields and malformed inputs.

Native STOP after calls projects tool_calls; text-only STOP/MAX_TOKENS/SAFETY retain stop/length/content_filter. Calls followed by truncation/safety cannot produce complete-call success. Bound parts per event and calls across the stream to 128, and retain at most one MiB of private IDs/names/argument string units through the shared function sequence. Successful outcomes retain frozen completed calls for response use only; text is not retained in outcomes. Failure discards private call assembly.

Require terminal followed by clean framed EOF, optionally one metadata-only usage tail. Native [DONE], unframed trailing data, content after terminal, repeated terminal/tail, missing terminal and reader failure fail safely. This is a bounded accepted ordering, not a claim that the generic Google schema guarantees every event's field presence or ordering. Final usage comes from final reported counters only, never an inferred prompt+candidate total, intermediate sums or earlier counter carry-forward. Missing/partial/invalid totals remain explicit. Await delivery callbacks; abort/deadline interrupts pending readers/callbacks. Opened failures remain sanitized and possibly billed; final compatible usage/success cannot bypass required persistence or audit.

## Verification and remaining scope

Native boundary tests cover parallel/separate whole calls, mixed Unicode, exact/missing IDs, bounds, malformed fields/objects, role/identity scope, final counter semantics, HTTP/EOF failures, backpressure and cancellation. Both installed OpenAI/OpenRouter SDKs on both bases exercise complete calls, result continuation, missing-ID native replay, fresh Deny, pre-frame gates, mid-stream/persistence failures, missing usage and abort. Generated persisted direct/dual servers use stored registration, replace caller overrides and keep read-side usage/audit private.

This is signature-free GenerateContent fixture conformance. It does not support Interactions deltas, Vertex partial argument streaming, thinking/signature replay, built-in/rich tools or model capability/name equivalence, and does not certify live providers. Full #116, unresolved #7 and broader named-client conformance remain open; schema pin v19 is unchanged.

The separate [nonstream function signature contract](gemini-function-signatures.md) does not activate signed native streams or signed stream histories. These still fail safely before keys or terminal success.
