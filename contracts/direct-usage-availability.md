# Direct-provider token usage availability

Direct OpenAI, Anthropic, and Google Gemini completions project recognized token counters to optional `prompt_tokens`, `completion_tokens`, and `total_tokens` fields. Supplied nonnegative safe integers, including zero, are preserved. Missing fields are omitted. Supplied invalid values become null; arbitrary strings, objects, or arrays are never copied into responses or accounting.

When a total is absent and both component counts are valid, derive their sum. If the sum exceeds the safe integer range, use null. A supplied invalid total is never replaced by a derived total. Anthropic supplies no total counter in this adapter's mapping, so its total is derived only when both components are valid.

All absent counters omit the usage object. The existing usage ledger labels complete valid counters reported, incomplete valid counters partial, no counters missing, and any invalid counter invalid. Its invalid records keep token counts null. A successful text completion remains successful even when its usage is invalid or missing. No billing amounts are inferred.

This change applies to recognized counter fields in the existing provider usage mappings. Validation of malformed usage containers, provider billing, quotas, and OpenRouter reconciliation remain separate concerns.
