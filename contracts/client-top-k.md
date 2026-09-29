# Client Top-K Contract

Both chat prefixes accept optional nullable nonnegative JavaScript safe-integer top_k. Null/omission preserves native defaults; supplied zero and positive values remain exact. Negative, fractional, unsafe, nonfinite and non-number values reject before routing. Native adapters repeat validation and capture scalars before credentials.

OpenRouter/Anthropic forward top_k; Gemini maps generationConfig.topK with the native int32 upper bound (2147483647), including settings-only requests. Direct OpenAI rejects supplied non-null controls, including zero, before secret/transport. Destination rejections use the existing safe 502 and do not fabricate provider usage. No clamping, default injection, prompt rewriting or capability-aware rerouting is added.

Native mappings are model-dependent: newer Anthropic models reject top_k and some Gemini models do not support it. Upstream rejection keeps existing safe failure/usage accounting. Exact field forwarding does not guarantee universal support or deterministic output. IAM, limits and required audit remain shared. Full capabilities, other sampling controls and tool/stream/client conformance remain open; top_k is included in the reviewed thirteen-field source-drift allowlist; this does not validate native provider capabilities.
