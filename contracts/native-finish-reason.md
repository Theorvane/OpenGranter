# Nonstream native finish reason metadata

Both chat bases preserve exact optional native_finish_reason string/null on the single normalized choice from direct OpenAI-compatible and delegated OpenRouter responses. Empty and Unicode strings are valid; missing remains absent. Capture once at the response boundary. This field is opaque upstream metadata, independent of the existing canonical finish_reason validation and never a policy authority.

Text, refusal, content_filter and function-tool responses retain supplied values. Malformed boolean/number/array/object fields fail with fixed safe 502 responses after dispatch and retain possibly-billed attempt accounting. Denial, explicit Deny, limits and required audit/ledger outcomes retain their existing gates. Native reasons, prompt/response content and secrets remain outside operational audit, usage records and errors.

The [official overview](https://openrouter.ai/docs/api_reference/overview) documents string/null native reasons. Current official ChatChoice and installed OpenRouter chat SDK omit this field; the SDK strips it. HTTP and OpenAI SDK JSON retention are covered, while full OpenRouter chat SDK retention and source-schema coverage remain explicit gaps. No fabricated schema property is added to the source pin.

Native Anthropic/Gemini adapters omit the extension and retain current canonical mappings. No reason is synthesized from stop_reason/finishReason. Streaming support, new canonical reasons, full response instance validation and complete external-client compatibility remain outside this slice. See [plan](../docs/plans/264-native-finish-reason.md).
