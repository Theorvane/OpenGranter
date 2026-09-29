# Client top_p contract

## Accepted values and capture

Both chat paths and all four adapter boundaries accept omitted/null top_p or a finite number in the inclusive 0..1 range. Zero, one and fractional values are preserved. Nonnumeric (other than null), non-finite, negative and values above one reject before route/credential/provider work, using existing safe failures and required HTTP denial audit. Adapters capture the validated primitive before asynchronous credential lookup; later changes to the request object do not alter it.

## Native mapping

OpenRouter, OpenAI and Anthropic send top_p unchanged. Gemini sends generationConfig.topP alongside any stopSequences and maxOutputTokens. Null normalizes to omission before capture and sends no native null. Omission sends no sampling default, including when generationConfig is absent. Supplied stop and output limits keep their existing validation, immutable capture and administrator caps.

## Security and model restrictions

The option never grants destination access or bypasses request limits, audit, or per-attempt accounting. Upstream rejection remains a safe provider failure and is recorded through existing usage semantics. Neither raw provider errors nor prompt/response content can enter operational records.

This is parameter mapping, not proof that every model accepts top_p. Current Anthropic documentation restricts some newer models to backward-compatible values at least 0.99. Model-dependent parameter capabilities, paired sampling restrictions and reasoning-model support remain compatibility work. OpenGranter does not silently clamp or discard the caller's value. Full compatibility remains blocked by #116.

## Sources checked 2026-09-29

- [OpenRouter parameters](https://openrouter.ai/docs/api_reference/parameters): top_p range and omission semantics.
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create): native top_p field and model-dependent restriction.
- [Gemini content generation](https://ai.google.dev/api/generate-content): generationConfig.topP.
