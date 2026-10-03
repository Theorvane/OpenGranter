# OpenRouter text SSE output subset

The internal encoder accepts one already decoded, authorized text-stream event. A delta becomes one `data: {json}\n\n` frame with `id`, `object: "chat.completion.chunk"`, `created`, the client-visible model alias and one indexed choice. The delta contains supported assistant role, text content and bounded optional refusal fields under the [refusal contract](stream-refusals.md); `finish_reason` is null or the validated terminal reason. JSON string escaping keeps embedded text, including newlines, within that frame.

A final usage event with valid nonnegative safe-integer `prompt_tokens`, `completion_tokens` and `total_tokens` becomes a usage frame. When a finish reason is present, it contains one empty-content assistant choice and repeats that reason; when the upstream accepted empty-choice variant has no finish reason, it emits `choices: []`. Missing, null or invalid counters produce no usage frame. The encoder never fabricates usage or erases the accounting layer's missing/invalid marker. `[DONE]` becomes exactly `data: [DONE]\n\n`.

Top-level upstream error events and unknown event types fail with a fixed local error and never serialize provider details. The encoder does not accept arbitrary response fields, evaluate permissions, validate sequence order or expose a public streaming route. The [delegated HTTP composition](delegated-http-stream.md) integrates authorization, sequence validation, delivery, usage and audit for the public text subset. Omitting incomplete usage differs from OpenRouter's documented final usage promise; this remains a compatibility gap to report rather than a complete-compatibility claim.

Sources: [OpenRouter streaming documentation](https://openrouter.ai/docs/api_reference/streaming), [OpenRouter OpenAPI](https://openrouter.ai/openapi.json).

The delta projection additionally preserves optional refusal and reasoning string/null fields under their [refusal](stream-refusals.md) and [reasoning](stream-reasoning.md) contracts. Each field is independently validated and JSON-encoded; final usage never carries forward earlier response text. Public delegated delivery uses the [HTTP composition](delegated-http-stream.md).

Summary/text/encrypted reasoning details use the [detail contract](stream-reasoning-details.md). Optional tier and native-finish metadata use the [tier](stream-service-tiers.md) and [native-finish](stream-native-finish-reason.md) contracts; final metadata comes from the actual usage event.
