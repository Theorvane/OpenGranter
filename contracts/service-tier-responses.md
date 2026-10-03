# Nonstream service tier response metadata

Direct OpenAI and delegated OpenRouter normalized nonstream completions preserve supplied service_tier string/null and omission exactly on both chat bases. Empty/unknown strings are valid, matching the optional official ChatResult property. Text, refusal, content_filter and function-tool responses share this scalar capture and projection. Each normalizer reads it once before type validation.

Supplied non-string/non-null values fail through existing safe adapter errors and possibly-billed failed-attempt accounting. Tier values are untrusted response metadata and do not choose a route/model/provider, establish IAM authority, bypass limits, alter cost estimates or assert provider-billed price. Operational audit/ledger/error payloads never copy them. Required ledger/outcome audit failures still suppress successful client output.

Native Anthropic/Gemini fields are not translated or fabricated. Client service_tier request controls remain rejected, and stream tier metadata is outside this subset. Gateway fingerprint and compatible usage projections preserve this field through normal object cloning.

Pinned official OpenRouter/OpenAI SDK socket regressions cover both paths. Remaining metadata, native/request/stream tier semantics and full external-client certification remain open. The pending reviewed ChatResult source projection already selects this property; this runtime change does not refresh the source pin.

See [plan](../docs/plans/248-service-tier.md) and [compatibility inventory](../docs/openrouter-compatibility.md).
