# Portable Client Response Formats

Both chat prefixes accept omission or an exact response_format object with type=text or json_object. Null, extra keys, missing/wrong type and grammar/python reject before routing. The bounded json_schema subset below is supported separately. Snapshot and freeze the bounded format before async credential resolution at HTTP and native adapter boundaries.

OpenAI/OpenRouter forward the captured object. Gemini sets generationConfig.responseMimeType to text/plain or application/json. Anthropic text maps to its default without an extra field; json_object rejects before credentials/transport with safe existing 502 attempt accounting (possiblyBilled=false). Unsupported mode does not select a new route or widen IAM scope.

Format mapping retains alias, singleton response, IAM, limits, required audit and usage. Omission preserves defaults and combined stop/token/sampling controls remain intact. Prompts are not rewritten; upstream models must support the requested format. Native JSON generation is not local JSON schema validation or repair, and refused/truncated completions retain their existing semantics. Local schema enforcement/repair, capability-aware selection/discovery and native Anthropic/Gemini schema mappings remain pending.

## Bounded JSON-schema format

Both bases accept {type:json_schema,json_schema:{name,schema?,description?,strict?}}. Name is 1..64 ASCII letters/digits/underscore/hyphen; schema is an optional plain JSON object; description is an optional string and strict an optional boolean/null, preserved without a default. Outer/config extra keys reject. Schema omission is preserved exactly, without injecting an empty object; explicit null/array/boolean or own undefined remains invalid at an independent adapter boundary. SDK JSON serialization drops undefined before HTTP transport. The minimum/name character guard is a gateway constraint, not an OpenAPI pattern requirement.

Capture the entire format before asynchronous work at HTTP and adapter boundaries: at most 20,000 JSON nodes and depth 64, finite numbers, plain objects and dense arrays only. Accessors, cycles, unsupported prototypes, holes and non-JSON values reject without reading accessor values. Preserve nested literal keys including $ref without dereferencing URLs or treating schema text as routing authority. Freeze every copied container.

Direct OpenAI and delegated OpenRouter forward the exact captured format, including existing delegated streaming. Direct Anthropic/Gemini reject json_schema before credentials/transport with existing safe 502 handling, no possibly-billed dispatch and no fabricated usage record. IAM, limits, required audit/usage and denial/failure controls remain shared. Schema text stays out of operational records and errors. Refusal/filter/truncation outputs retain their existing semantics; the gateway neither validates nor repairs returned JSON. Model/endpoint enforcement varies, so forwarding does not certify output conformance.

Official OpenAI and OpenRouter SDK socket cases cover both bases; delegated streaming carries the schema and emits one final usage event after persistence. Managed OpenAI streaming is measured under #552 below; native Anthropic/Gemini schema rejection remains. Other referenced-format source drift, complete instance conformance, native schema mappings and capability-aware endpoint selection remain open under #116. Source reviewed 2026-10-03: [official structured-output guide](https://openrouter.ai/docs/guides/features/structured-outputs), official OpenAPI ChatJsonSchemaConfig and installed SDK 1.4.18. See [plan](../docs/plans/296-json-schema-formats.md).

The supported JSON-schema wrapper/config now have structural source-drift coverage in [version 16](openrouter-schema-drift.md); this does not validate client or provider JSON instances.

Named configs with omitted schema retain the same pre-secret snapshots and security/persistence controls as supplied schemas. Provider acceptance and output enforcement remain model-dependent; missing schema does not certify structured output. See [omission plan](../docs/plans/300-optional-config-schema.md).

## Actual AI SDK object generation (#552)

Pinned OpenRouter AI SDK provider 3.1.0 with AI SDK 7.0.153 and Zod 4.6.6 forwards the exact measured draft-07 string-property object schema/name/description/strict:true wrapper on both bases for delegated and managed OpenAI nonstream/stream calls. This verifies current managed OpenAI streaming, superseding the earlier managed-stream exclusion for this subset. Native Anthropic/Gemini still reject json_schema before credentials/transport.

The application-side parser rejects malformed JSON/wrong property types after successful provider completion, retaining server success accounting. Default Zod object validation strips extra properties; gateway text is unchanged, so neither an advertised strict wrapper nor a client object proves full returned-schema compliance. NoObjectGeneratedError contains returned text and usage locally. After a streaming required-persistence error, result.output may still resolve from delivered text even while actual server final usage/DONE is withheld. Inspect stream error parts and retain the existing accounting/persistence contract. No gateway JSON validation/repair, native schema conversion or new response fields are introduced. See [AI SDK contract](ai-sdk-client-workflows.md#structured-object-workflows-552), [plan](../docs/plans/552-ai-sdk-structured-output.md) and [reproduction](../docs/ai-sdk-conformance.md#structured-object-reproduction-552); full #116 and unresolved #7 remain open.

## Bounded direct Gemini JSON schemas (#572)

Direct Gemini accepts json_schema only with explicit strict:false and a supplied object-root schema. It forwards the captured tree unchanged as generationConfig.responseJsonSchema alongside application/json MIME. Name and outer description are format labels only, not native instructions. The recursive subset requires a single string type: object, array, string, number, integer, boolean or null. Optional title/description must be strings. Object nodes alone accept properties (schema map), required (unique existing property names) and boolean or recursively validated schema-valued additionalProperties (#580).  Array nodes require one items schema. Unknown keywords, type unions, references, inappropriate keyword/type combinations, nesting beyond16, missing schemas and other strict values reject before credentials. Shared JSON resource limits apply first. Any supplied tools/tool_choice/parallel_tool_calls is rejected for this schema subset, including empty tools and none.

Text streaming and nonstream use the same snapshot and transport validation. No output repair/local schema enforcement, strict-equivalence, live model eligibility, function composition or native Anthropic support is claimed. Upstream refusal/truncation, safe errors, full model/provider IAM, limits, required usage/audit and missing/possibly-billed semantics remain unchanged. OpenAI/OpenRouter and Gemini text/json_object retain existing behavior. See [plan](../docs/plans/572-gemini-response-schema.md).


## Bounded Gemini string and numeric enums (#574)

The #572 subset additionally accepts enum only on explicitly typed string, number or integer nodes. Each list must contain1..128 unique values matching that type; numeric values must be finite and integer values integral. The128 limit and duplicate rejection are local restrictions. Empty, mixed-type, boolean/null/object/array enums reject before credentials. Captured values and ordering are forwarded unchanged, including nested array items, on text streams and nonstream calls; there is no generated-output enum enforcement or strict/live-model guarantee. All #572 IAM, limits, persistence, privacy, root/type/tool and snapshot restrictions remain. See [plan](../docs/plans/574-gemini-schema-enums.md).

## Bounded Gemini numeric constraints (#576)

The strict:false object-root subset accepts finite numeric minimum/maximum on explicit number/integer nodes, including fractional bounds on integers without rounding. Pairs must be ordered; equality and one-sided bounds are allowed. Malformed, nonfinite, reversed and inappropriate-type bounds reject before credentials. Exact captured constraints pass through nonstream/text streams (JSON canonicalizes negative zero); no generated-output enforcement, enum intersection or integer-interval satisfiability check is performed. Exclusive bounds and other unsupported keywords remain rejected. All existing IAM/limits/persistence/privacy rules apply. See [plan](../docs/plans/576-gemini-numeric-schema.md).


## Bounded Gemini array lengths (#578)

The strict:false object-root Gemini subset additionally transports minItems/maxItems only on explicitly typed arrays with an items schema. Lengths must be nonnegative safe integers; pairs must be ordered, with equality and one-sided bounds allowed. Nested lengths and captured values are preserved on nonstream/text streams. Wrong-type, negative, fractional, unsafe, nonfinite and reversed bounds reject before credentials. This is not generated-output enforcement or satisfiability certification. All existing IAM/limits/persistence/privacy and tool/strict/root restrictions remain; #116/#7 stay open. See [plan](../docs/plans/578-gemini-array-lengths.md).

## Bounded Gemini additional property schemas (#580)

The strict:false object-root subset additionally transports schema-valued additionalProperties on explicit object nodes, recursively applying the same type/keyword and depth<=16 restrictions as properties/items. Boolean values retain existing behavior. Typed nested object/array/scalar schemas are captured and forwarded unchanged in nonstream and native text streams; untyped, malformed, unsupported or excessive-depth schemas fail before credentials. This supersedes the earlier boolean-only limitation, not unsupported union/reference/strict/tool behavior. No generated-output enforcement, satisfiability or live-model certification follows. IAM, limits, audit/usage and privacy boundaries remain covered; #116/#7 remain open. See [plan](../docs/plans/580-gemini-property-schemas.md).


## Bounded Gemini nested anyOf (#582)

The strict:false explicitly object-root responseJsonSchema subset additionally accepts nested anyOf lists of 1..16 recursively validated branches. AnyOf-only nodes may contain title/description; explicitly typed nodes retain all type-specific rules. Branches share the depth<=16 boundary with properties/items/additionalProperties. Capture and transport remain immutable on nonstream and native text streams. Malformed/empty/oversized lists, unsupported branch keywords and excessive depth reject before secrets. Untyped root unions, oneOf/references, strict/tool composition remain unsupported. This is transport only, not output enforcement, satisfiability or live-model certification. The transport remains deprecated in the upstream API; full #116 and unresolved #7 stay open. See [plan](../docs/plans/582-gemini-anyof.md).
