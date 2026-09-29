# Client Seed Contract

Both chat prefixes accept optional seed as null or a JavaScript safe integer. Null/omission leaves upstream defaults untouched. Fractional, unsafe, nonfinite and non-number values reject before routing; negative, zero and positive accepted integers remain exact. Native adapters repeat validation and capture scalars before credentials.

OpenAI/OpenRouter forward seed. Gemini uses generationConfig.seed, including seed-only settings, and applies its official signed int32 bounds (-2147483648..2147483647) before credentials/transport. Direct Anthropic rejects supplied non-null seeds, including zero. Destination rejections use the existing safe 502 without fabricated provider usage. No clamping, random seed injection, prompt rewriting or capability-based rerouting is introduced.

IAM, limits, required audit and per-attempt usage remain shared. Safe field forwarding does not guarantee deterministic output or model support. Provider-specific fingerprints, per-model capabilities, other request parameters, tools and streaming remain open. The independent schema-drift field allowlist does not yet include seed.
