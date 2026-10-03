# Non-streaming Refusal Outcomes

OpenAI and delegated OpenRouter responses contain exactly one choice at index zero with assistant role. String content is retained. Null content is accepted only with a nonempty string refusal or a content_filter finish reason. Missing content is invalid. If present, refusal must be string or null and is retained, including explicit null. Empty refusal alone cannot justify null content.

The ordinary text/refusal subset preserves stop, length, content_filter and explicit null finish reasons. Unsupported, missing or malformed reasons fail safely under the [finish-reason contract](upstream-finish-reasons.md). Validated non-streaming function calls follow the separate [tool-response contract](function-tool-responses.md), including their nullable/omitted content rules. Native subsets are defined in the [Anthropic refusal contract](anthropic-refusals.md) and [Gemini SAFETY contract](gemini-safety.md); richer native filtering remains pending.

Valid refusal/filter completions are delivered with HTTP 200 through both prefixes and retain provider usage. Delivery counts as a successful attempt and never triggers fallback. IAM, limits and required audit still apply before invocation. Refusal/content stays in the API response and out of metadata audit, usage and error payloads. Malformed responses fail safely after the upstream response with possible billing recorded.

Delegated streaming supports optional string/null refusal deltas separately under the [stream refusal contract](stream-refusals.md). Valid refusal streams are successful deliveries with shared required accounting/audit and no fallback; malformed values fail safely. No transcript enters operational metadata.

Already-valid non-streaming refusal/filter responses additionally preserve optional reasoning string/null under the [reasoning contract](nonstream-reasoning.md), without relaxing content validation or copying reasoning into operational metadata.
