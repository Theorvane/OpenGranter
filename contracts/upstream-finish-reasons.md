# Non-streaming Upstream Finish Reason Contract

Direct OpenAI and delegated OpenRouter preserve stop, length, content_filter and explicit null in the supported text-completion subset. A missing field is distinct from explicit null. Normal/refusal/filter message validation remains required.

Error, invocation/unknown reasons and malformed/missing finish_reason fail through existing safe post-response provider failures. Do not replace unsupported termination semantics with null and return success. Failed-attempt accounting preserves possibly billed status without fabricated usage totals. Reasons and response bodies stay out of errors and metadata audit.

IAM, limits, required audit, fallback candidate scope and native Anthropic/Gemini mappings remain unchanged. This does not add tool/stream support, precise upstream error categories, new retry policy or full response-schema validation. Official ChatChoice/ChatFinishReasonEnum source: https://openrouter.ai/openapi.json (snapshot retrieved 2026-09-29).
