# Provider usage container validation

Direct OpenAI and Anthropic `usage`, Gemini `usageMetadata`, and delegated OpenRouter `usage` are checked before counter extraction.

- Absent or null containers mean missing usage and omit normalized usage.
- Non-null strings, numbers, booleans, and arrays are malformed. Normalize them to `usage: { total_tokens: null }`; the existing ledger marks usage invalid and keeps token counts null.
- Object containers use the existing known-counter projection. Empty objects and objects with no recognized counters remain missing; unrelated fields are discarded.

Successful text completion remains successful independently of container validity. Raw malformed values and unrelated object fields never enter normalized responses, usage records, or audit. This marker is reporting quality, not a billed amount or an inference failure. Existing partial/invalid-counter and safe-total semantics remain unchanged; no schema or new availability status is introduced.
