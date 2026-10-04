# Stream token probability contract

Issue #424. Plan: [424-stream-logprobs](../docs/plans/424-stream-logprobs.md).

Both /v1 and /api/v1 accept nullable optional logprobs boolean and top_logprobs integer 0..20 requiring true for managed OpenAI/delegated OpenRouter text/refusal/function streams. Null/absence omits native controls; false/zero retain exact values captured before secret awaits. Native Anthropic/Gemini supplied controls reject before credentials. This supersedes only the streaming exclusion in [nonstream-logprobs](nonstream-logprobs.md).

Choice-level logprobs preserves absent/null or deep immutable content/refusal token groups, alternatives and bytes under the existing nonstream shape and local bounds. Do not admit delta.logprobs, infer tool-argument probabilities, derive usage, accumulate whole-stream probabilities or store response tokens/bytes in operational records/errors. Preserve existing one-MiB framed SSE bound, awaited delivery and cancellation. Native OpenAI still accepts usage:null deltas and requires empty-choice final usage.

Delegated content-free final usage choices may carry logprobs; retain one private bounded sidecar, excluding it from routing/accounting summaries. Required usage and outcome audit handoffs precede its client frame and DONE. If aggregate usage is missing, emit the supplied probability metadata without usage counters; missing ledger usage remains missing. Failures clear retained sequence content, withhold final probability metadata/DONE and preserve safe possibly-billed failure accounting. Invalid first events fail before delivery; invalid later/final events fail safely after partial delivery without fallback.

Per-model support, native probability mapping, live providers and complete #116 remain open. SDK and source pins do not change. Sources: [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [parameters](https://openrouter.ai/docs/api/reference/parameters), [streaming](https://openrouter.ai/docs/api/reference/streaming), [OpenAI streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).
