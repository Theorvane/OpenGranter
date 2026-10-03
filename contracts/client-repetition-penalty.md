# Delegated repetition-penalty sampling control

Both compatible chat bases accept optional nullable repetition_penalty. Supplied values must be finite numbers in inclusive 0..2; zero/fractions/one/two are forwarded exactly. Null/omission is normalized to absence and preserves upstream defaults. Malformed HTTP values reject before routing. Native delegated preparation repeats validation and captures the scalar once before credential awaits in its frozen request body.

Delegated OpenRouter nonstream and existing text-stream requests retain the captured repetition_penalty along with the administrator-approved model and IAM-evaluated final-provider scope. Registered direct OpenAI/Anthropic/Gemini adapters reject any non-null supplied repetition_penalty before secret/transport rather than drop it. Existing safe 502 and non-billed accounting semantics apply; null/omission keeps their defaults.

The official [parameters](https://openrouter.ai/docs/api_reference/parameters) document the 0..2 range, while the official ChatRequest structural schema has optional number/null with double format and no encoded range. SDK repetitionPenalty maps to repetition_penalty. Per-model support remains upstream-dependent: forwarding does not certify that every model/provider accepts the control. No clamping, default injection or capability-aware rerouting is added.

Authentication, model/final-provider IAM, limits, required audit/usage, cancellation/backpressure and safe post-dispatch failures remain shared. Client sampling values cannot select destinations or alter accounting authority. Content/secrets stay out of operational metadata/errors.

The current structural source pin does not select repetition_penalty; source drift coverage needs an explicit follow-up and remains partial. This does not claim full request/provider/tool/stream/external-client conformance. See [plan](../docs/plans/260-repetition-penalty.md).
