# Client temperature contract

## Values and capture

Both chat paths accept omitted temperature or a finite number in the inclusive 0..2 range. Null, nonnumeric, non-finite, negative and values above two reject before route/credential/provider work with required denial audit. OpenRouter/OpenAI/Gemini adapters enforce the same range. Direct Anthropic enforces its native inclusive 0..1 range before credential lookup and transport. No clamping, rescaling or sampling default is injected.

Capture the validated primitive before asynchronous credential lookup. Later request-object mutation cannot alter it. Preserve stop and output maxima, their validation/snapshots, and configured output caps.

## Native fields and failures

OpenRouter/OpenAI/Anthropic send temperature unchanged. Gemini sends generationConfig.temperature alongside any stopSequences and maxOutputTokens. Omission does not create generationConfig when other settings are also absent.

A valid client value outside the Anthropic native range fails at that adapter after gateway IAM and limits, using existing safe non-retryable/non-billable failure behavior. HTTP reports upstream_failed and audits a failed attempt with no credential lookup or provider transport. Existing managed-route semantics omit a usage ledger entry for this known non-billable, unstarted attempt. Existing same-kind fallback semantics are unchanged. Global invalid input is instead an invalid-request denial before route work.

The option grants no destination access and cannot bypass authentication, IAM, limits, audit or usage. Raw upstream errors, content and keys stay out of operational records.

## Model capability gaps

Current Anthropic documentation restricts some newer models to temperature 1 for backward compatibility. Other native models can also limit sampling support. Parameter mapping does not certify every model or parameter combination; unsupported model settings use safe upstream errors until trusted capability metadata exists. Temperature/top_p pairing and complete external-tool compatibility remain open under #116.

## Sources checked 2026-09-29

- [OpenRouter parameters](https://openrouter.ai/docs/api_reference/parameters): inclusive 0..2 and omission behavior.
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create): inclusive 0..1 and model-dependent restrictions.
- [Gemini content generation](https://ai.google.dev/api/generate-content): generationConfig.temperature and inclusive 0..2.
