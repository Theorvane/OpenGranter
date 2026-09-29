# Frequency and Presence Penalty Contract

Both chat prefixes accept each optional frequency_penalty/presence_penalty as null or finite number in [-2,2]. Null/omission follows existing omission behavior; negative/zero/positive values remain exact. Other values reject before routing. Native adapters repeat validation and capture scalars before secrets.

OpenAI/OpenRouter forward snake_case fields. Gemini maps generationConfig.frequencyPenalty/presencePenalty, including when penalties are the only generation settings. Direct Anthropic rejects supplied non-null penalties, including zero, before credentials/transport; no fabricated usage row or widened route results. Null/omission remains supported.

Both paths and SDK retain IAM, limits, required audit, existing controls and safe usage. Model-dependent support is not guaranteed by field mapping. Per-model capability routing/discovery, native Anthropic penalties and broader sampling remain pending. No prompt rewriting or silent clamping is performed.
