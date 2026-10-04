# Direct-provider token usage availability

Direct OpenAI, Anthropic, and Google Gemini completions project recognized token counters to optional `prompt_tokens`, `completion_tokens`, and `total_tokens` fields. Supplied nonnegative safe integers, including zero, are preserved. Missing fields are omitted. Supplied invalid values become null; arbitrary strings, objects, or arrays are never copied into responses or accounting.

For direct OpenAI and Anthropic, when a total is absent and both component counts are valid, derive their sum. If that sum exceeds the safe integer range, use null. A supplied invalid total is never replaced by a derived total. Anthropic supplies no total counter in this adapter's mapping, so its total is derived only when both components are valid.

Google Gemini totalTokenCount includes hidden thinking and may exceed promptTokenCount plus candidatesTokenCount. Its total is preserved only when supplied; a missing total is never derived, in nonstream text/safety responses or native streams. Known valid components with an omitted total produce partial ledger usage, including independently valid counts whose hypothetical sum would exceed the safe integer range. A supplied invalid total remains invalid. Historical records are not recomputed from unavailable native data.

All absent counters omit the usage object. The existing usage ledger labels complete valid counters reported, incomplete valid counters partial, no counters missing, and any invalid counter invalid. Its invalid records keep token counts null. A successful text completion remains successful even when its usage is invalid or missing. No billing amounts are inferred.

This change applies to recognized counter fields in the existing provider usage mappings. The [container contract](provider-usage-containers.md) defines malformed-container handling. Provider billing, quotas, and OpenRouter reconciliation remain separate concerns.

The compatible /api/v1 nonstream boundary omits incomplete usage as a whole under [its existing contract](compatible-completion-usage.md); /v1 keeps sparse known counters. Both paths retain known counters and unknown total in protected partial ledger history. The SDK discovery/invocation regression now verifies that the unchanged Google fixture without total does not fabricate one.
