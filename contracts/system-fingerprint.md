# Non-streaming System Fingerprint Contract

Direct OpenAI and delegated OpenRouter preserve optional string/null system_fingerprint from valid upstream singleton completions on both chat prefixes. Values are opaque and exact, including empty/Unicode strings; omission remains omission. Normal text, refusal and content_filter responses retain the field. Native Anthropic/Gemini mappings omit it, including unexpected similarly named native fields.

Non-string/non-null upstream values fail via the existing safe post-response provider failure path. The attempt can be billed; failed-attempt usage remains visible without fabricated token totals or exposing response details. Existing IAM, limit, audit and accounting controls continue across the same boundaries.

Fingerprints are upstream protocol data, not authenticated identity, verified provider identity, determinism guarantees or usage attribution. Keep them out of operational logs, audit metadata and errors. No generated fingerprints, schema instance validation, response-schema drift expansion or streaming support is introduced.
