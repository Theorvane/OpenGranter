# OpenRouter text SSE output subset

The internal encoder accepts one already decoded, authorized text-stream event. A delta becomes one `data: {json}\n\n` frame with `id`, `object: "chat.completion.chunk"`, `created`, the client-visible model alias and one indexed choice. The delta contains only the supported assistant role and text content fields; `finish_reason` is null or the validated terminal reason. JSON string escaping keeps embedded text, including newlines, within that frame.

A final usage event with valid nonnegative safe-integer `prompt_tokens`, `completion_tokens` and `total_tokens` becomes a usage frame. When a finish reason is present, it contains one empty-content assistant choice and repeats that reason; when the upstream accepted empty-choice variant has no finish reason, it emits `choices: []`. Missing, null or invalid counters produce no usage frame. The encoder never fabricates usage or erases the accounting layer's missing/invalid marker. `[DONE]` becomes exactly `data: [DONE]\n\n`.

Top-level upstream error events and unknown event types fail with a fixed local error and never serialize provider details. The encoder does not accept arbitrary response fields, evaluate permissions, validate sequence order or expose a public streaming route. A future gateway must compose authorization, sequence validation, delivery, usage and audit before enabling client `stream:true`. Omitting incomplete usage differs from OpenRouter's documented final usage promise; this remains a compatibility gap to report rather than a complete-compatibility claim.

Sources: [OpenRouter streaming documentation](https://openrouter.ai/docs/api_reference/streaming), [OpenRouter OpenAPI](https://openrouter.ai/openapi.json).
