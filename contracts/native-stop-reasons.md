# Native Non-streaming Stop Reason Contract

Direct Anthropic text output accepts end_turn/stop_sequence as compatible stop and max_tokens as length. The existing bounded refusal case remains content_filter. Direct Gemini text output accepts STOP as stop and MAX_TOKENS as length. The existing bounded SAFETY prompt/candidate cases remain content_filter.

Unsupported, malformed or missing native reasons fail through existing safe post-response provider failures, even if the upstream supplied text. Anthropic tool_use/pause_turn and Gemini RECITATION/MALFORMED_FUNCTION_CALL are examples that must not be reported as successful null-finish text. No new blocked-outcome mapping, retry category, fallback scope, tool continuation or streaming behavior is implied.

Failed attempts retain possibly billed accounting without fabricated token totals. The reason, response content and credentials stay out of operational errors and metadata audit. IAM, limits and required audit continue to gate all routes before upstream calls. Sources: [Anthropic stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) and [Gemini FinishReason](https://ai.google.dev/api/generate-content).
