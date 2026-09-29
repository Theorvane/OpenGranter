# Unsupported Upstream Tool Output Contract

Until tool workflows are implemented, non-streaming direct OpenAI and delegated OpenRouter responses fail safely when an assistant output contains populated/malformed tool_calls, non-null function_call, or a tool_calls/function_call finish reason. Text accompanying invocation fields does not convert an invocation into an ordinary successful text completion.

Omitted/null/empty-array tool_calls and omitted/null function_call represent no invocation and retain the existing text/refusal/filter subset. No tool input or invocation continuation support is introduced. Native provider mappings remain unchanged.

Existing post-response failure handling records the possibly billed attempt without fabricated tokens. Errors and metadata audit never expose names, arguments or response content. IAM, limits and required audit gates remain ahead of upstream calls. Fallback continues under existing route-kind/authorized-candidate rules; no new error category or retry policy is introduced.
