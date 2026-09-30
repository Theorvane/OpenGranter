# OpenRouter chat stream chunk subset

The internal decoder accepts one complete SSE `data` payload from the bounded frame parser. The exact `[DONE]` marker becomes a done event. A top-level `error` property becomes a safe upstream-error event even when it is the first event; the provider's message and code never leave the decoder.

Supported text chunks require a nonempty id, `chat.completion.chunk` object, nonnegative safe-integer creation time, the selected upstream model, one choice at index zero and an object delta containing only optional assistant role and string/null content. Finish reason is null, stop, length or content_filter. The decoder emits the authorized local model alias. Tool calls, rich/reasoning deltas, other finish reasons and ambiguous/malformed shapes fail with a fixed error.

An explicit `usage` property marks a final usage chunk. It must have a terminal finish reason and a content-free delta. Its counters use the existing provider-usage normalization, which preserves missing and invalid values for later accounting. Sequence order, repeated finish-reason matching, complete termination, cancellation, usage persistence, audit and safe client SSE delivery are separate gates. Client `stream:true` remains rejected.

Source: [OpenRouter streaming documentation](https://openrouter.ai/docs/api_reference/streaming).
