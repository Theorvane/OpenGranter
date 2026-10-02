# Delegated stream fingerprints

Validated delegated text/terminal and complete final usage chunks preserve optional string system_fingerprint exactly. Omission stays omission. Null is a bounded local OpenAI compatibility allowance consistent with non-streaming behavior; the reviewed official OpenRouter stream schema declares string only.

Final usage uses the fingerprint from its own upstream event, independently of previous chunks. A changed value does not change authenticated identity, provider permissions or usage attribution; no cross-chunk equality is asserted. Missing/invalid token counters continue to suppress fabricated final usage frames.

Malformed fingerprint values reject via fixed safe errors: JSON before delivered frames, SSE error without DONE afterward. Dispatched failures remain possibly billed, with required failed-attempt accounting/audit. Fingerprints cannot bypass model/final-provider IAM or limits and stay outside audit metadata, ledger metadata, logs and error details. JSON encoding prevents frame injection. This does not add direct/tool/multimodal streaming, response instance validation or full external-client conformance.
