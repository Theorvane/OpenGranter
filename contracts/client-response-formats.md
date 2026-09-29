# Portable Client Response Formats

Both chat prefixes accept omission or an exact response_format object with type=text or json_object. Null, extra keys, missing/wrong type and json_schema/grammar/python reject before routing. Snapshot and freeze the bounded format before async credential resolution at HTTP and native adapter boundaries.

OpenAI/OpenRouter forward the captured object. Gemini sets generationConfig.responseMimeType to text/plain or application/json. Anthropic text maps to its default without an extra field; json_object rejects before credentials/transport with safe existing 502 attempt accounting (possiblyBilled=false). Unsupported mode does not select a new route or widen IAM scope.

Format mapping retains alias, singleton response, IAM, limits, required audit and usage. Omission preserves defaults and combined stop/token/sampling controls remain intact. Prompts are not rewritten; upstream models must support the requested format. Native JSON generation is not local JSON schema validation or repair, and refused/truncated completions retain their existing semantics. Strict JSON schema, capability-aware selection/discovery, native Anthropic JSON generation, tools and streaming remain pending.
