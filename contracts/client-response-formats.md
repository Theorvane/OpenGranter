# Portable Client Response Formats

Both chat prefixes accept omission or an exact response_format object with type=text or json_object. Null, extra keys, missing/wrong type and grammar/python reject before routing. The bounded json_schema subset below is supported separately. Snapshot and freeze the bounded format before async credential resolution at HTTP and native adapter boundaries.

OpenAI/OpenRouter forward the captured object. Gemini sets generationConfig.responseMimeType to text/plain or application/json. Anthropic text maps to its default without an extra field; json_object rejects before credentials/transport with safe existing 502 attempt accounting (possiblyBilled=false). Unsupported mode does not select a new route or widen IAM scope.

Format mapping retains alias, singleton response, IAM, limits, required audit and usage. Omission preserves defaults and combined stop/token/sampling controls remain intact. Prompts are not rewritten; upstream models must support the requested format. Native JSON generation is not local JSON schema validation or repair, and refused/truncated completions retain their existing semantics. Local schema enforcement/repair, capability-aware selection/discovery and native Anthropic/Gemini schema mappings remain pending.

## Bounded JSON-schema format

Both bases accept {type:json_schema,json_schema:{name,schema?,description?,strict?}}. Name is 1..64 ASCII letters/digits/underscore/hyphen; schema is an optional plain JSON object; description is an optional string and strict an optional boolean/null, preserved without a default. Outer/config extra keys reject. Schema omission is preserved exactly, without injecting an empty object; explicit null/array/boolean or own undefined remains invalid at an independent adapter boundary. SDK JSON serialization drops undefined before HTTP transport. The minimum/name character guard is a gateway constraint, not an OpenAPI pattern requirement.

Capture the entire format before asynchronous work at HTTP and adapter boundaries: at most 20,000 JSON nodes and depth 64, finite numbers, plain objects and dense arrays only. Accessors, cycles, unsupported prototypes, holes and non-JSON values reject without reading accessor values. Preserve nested literal keys including $ref without dereferencing URLs or treating schema text as routing authority. Freeze every copied container.

Direct OpenAI and delegated OpenRouter forward the exact captured format, including existing delegated streaming. Direct Anthropic/Gemini reject json_schema before credentials/transport with existing safe 502 handling, no possibly-billed dispatch and no fabricated usage record. IAM, limits, required audit/usage and denial/failure controls remain shared. Schema text stays out of operational records and errors. Refusal/filter/truncation outputs retain their existing semantics; the gateway neither validates nor repairs returned JSON. Model/endpoint enforcement varies, so forwarding does not certify output conformance.

Official OpenAI and OpenRouter SDK socket cases cover both bases; delegated streaming carries the schema and emits one final usage event after persistence. Managed streaming stays unsupported. Other referenced-format source drift, complete instance conformance, native schema mappings and capability-aware endpoint selection remain open under #116. Source reviewed 2026-10-03: [official structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs), official OpenAPI ChatJsonSchemaConfig and installed SDK 1.4.18. See [plan](../docs/plans/296-json-schema-formats.md).

The supported JSON-schema wrapper/config now have structural source-drift coverage in [version 16](openrouter-schema-drift.md); this does not validate client or provider JSON instances.

Named configs with omitted schema retain the same pre-secret snapshots and security/persistence controls as supplied schemas. Provider acceptance and output enforcement remain model-dependent; missing schema does not certify structured output. See [omission plan](../docs/plans/300-optional-config-schema.md).
