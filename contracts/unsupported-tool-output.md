# Unsupported Upstream Tool Output Contract

The original guard introduced by #172 rejects malformed or mismatched modern calls, any non-null legacy function_call, and invocation finish reasons without valid matching calls. Valid non-streaming function calls are now supported by [the response contract](function-tool-responses.md); do not apply the earlier blanket rejection to them. Text accompanying invalid invocation fields does not convert an invocation into ordinary successful text.

Omitted/null/empty-array tool_calls and omitted/null function_call represent no invocation for the ordinary text/refusal/filter subset. Native Anthropic/Gemini mappings, tool-result continuation and streaming remain outside this contract.

Invalid upstream responses use the existing possibly-billed failed-attempt path. Errors and metadata audit never expose call IDs, names, arguments or response content. IAM, limits and required audit remain ahead of upstream calls. Fallback stays within existing route-kind and authorized-candidate rules.
