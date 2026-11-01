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


## Bounded Gemini prefixItems (#584)

The strict:false explicitly object-root subset additionally transports prefixItems only on typed arrays, with 1..16 recursively validated schemas and optional supported items schema. Prefix-only arrays are allowed; arrays without prefixItems still require items. Prefix children/items share depth<=16 and all existing type/keyword restrictions. Empty prefixes, boolean items/children and oversized/malformed lists reject before credentials. Local bounds and boolean-schema restrictions are explicit compatibility limitations, not tuple/output enforcement or satisfiability certification. Immutable nonstream/native text-stream capture, IAM/limits/persistence/accounting/privacy remain unchanged. Deprecated responseJsonSchema transport does not certify live-model compatibility, full #116 or unresolved #7. See [plan](../docs/plans/584-gemini-prefix-items.md).


## Bounded Gemini string format annotations (#586)

The strict:false explicitly object-root subset accepts format only on explicitly typed string nodes, preserving exact 0..256 UTF-16 units including empty, whitespace and unknown names under all supported recursive nodes. Wrong-type, oversized and untyped annotations reject before credentials. The string-only and length bounds are local restrictions; official GenerationConfig lists format without a name enum. This is opaque annotation transport, not output validation, format enforcement, type conversion, satisfiability or live-model certification. Immutable nonstream/native text-stream capture, installed SDK sockets, IAM/limits/persistence/accounting/privacy retain existing boundaries. The responseJsonSchema transport is deprecated upstream; full #116 and unresolved #7 stay open. See [plan](../docs/plans/586-gemini-string-format.md).


## Bounded Gemini property ordering (#588)

The strict:false explicitly object-root subset accepts non-standard propertyOrdering only on explicitly typed objects: exact ordered lists of 0..128 unique strings naming own declared properties, including partial/empty lists and exact empty/prototype-like names when declared. Count, uniqueness and membership rules are local restrictions. Existing recursive depth/capture bounds apply; malformed/wrong-type/unknown/duplicate/oversized lists reject before credentials. This is immutable annotation transport on nonstream/native text streams, not generated-output ordering enforcement, satisfiability or live-model certification. IAM/limits/persistence/accounting/privacy remain unchanged. responseJsonSchema is deprecated upstream; full #116 and unresolved #7 remain open. See [plan](../docs/plans/588-gemini-property-ordering.md).


## Bounded Gemini nullable type pairs (#590)

On strict:false explicitly object-root schemas, nested type arrays accept exactly one supported non-null type plus null, in either order. Exact immutable schema and array order are forwarded on nonstream/native text streams. Existing keyword restrictions apply to the non-null type, with depth<=16 and capture budgets unchanged. Malformed/duplicate/unknown/larger and root-nullable arrays reject before credentials. Enums retain their existing non-null string/number restrictions. This transports nullability, not generated-output validation, satisfiability or live-model certification. Deprecated responseJsonSchema, IAM/limits/accounting/persistence/privacy and other native restrictions remain unchanged. See [plan](../docs/plans/590-gemini-nullable-types.md); full #116 and unresolved #7 stay open.


## Bounded Gemini oneOf transport (#592)

On strict:false explicitly object-root schemas, nested oneOf transports1..16 recursively supported branches unchanged on nonstream/native text streams. Gemini officially interprets oneOf as anyOf: exclusive matching is NOT guaranteed. This subset is immutable transport, not generated-output validation, satisfiability or JSON Schema equivalence. Same-node anyOf plus oneOf is locally rejected; malformed/count/depth/root/strict/keyword errors fail before secrets. Existing IAM/limits/persistence/accounting/privacy and capture bounds remain. Deprecated responseJsonSchema, unsupported references/tools/Anthropic, full #116 and unresolved #7 stay open. See [plan](../docs/plans/592-gemini-oneof.md) and [inventory](../docs/openrouter-compatibility.md).

## Bounded Gemini local schema references (#594)

The strict:false literal object-root subset additionally transports root-only $defs (1..128 simple ASCII identifier names, max64) and sole-key #/$defs/name references without rewriting. All definitions, including unused ones, and every resolved use are checked against the subset, expanded depth<=16 and shared 20,000-visit budget. Cyclic/dangling/external/escaped refs, reference siblings, nested $defs, $id/$anchor and unsupported schema keywords reject before secrets. No URL is fetched. This is immutable schema transport, not generated-output validation, recursive-reference support, satisfiability or live-model certification. Deprecated responseJsonSchema and strict/tool/Anthropic limitations remain; full #116 and unresolved #7 stay open. See [plan](../docs/plans/594-gemini-local-refs.md).

## Bounded Gemini array-root schemas (#596)

Explicit strict:false schemas additionally accept literal array roots with the same recursive keyword, depth<=16 and shared20,000-visit bounds as object roots. Items/prefixItems, min/maxItems and root-only local definitions/references are transported unchanged on nonstream/native text streams. Root scalar, nullable/type-array and untyped union/reference roots remain unsupported before credentials, as do strict/tool/Anthropic combinations. This supersedes the prior object-only root limitation, not generated-output validation, array-output guarantees, satisfiability or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; full #116 and unresolved #7 stay open. See [plan](../docs/plans/596-gemini-array-root.md) and [contract](../docs/openrouter-compatibility.md).


## Bounded Gemini scalar-root schemas (#598)

Explicit strict:false schemas additionally accept literal string, number, integer and boolean roots with unchanged recursive keyword/type/reference, expanded depth<=16 and shared20,000-visit bounds. Existing scalar enum/numeric/string-format restrictions apply at the root; schemas remain immutable on nonstream/native text streams. Root null, nullable/type-array and untyped union/reference roots, strict/tool/Anthropic combinations remain unsupported before credentials. This supersedes prior scalar-root-only rejection, not generated-output validation, scalar-output guarantees, satisfiability or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; full #116 and unresolved #7 stay open. See [plan](../docs/plans/598-gemini-scalar-root.md).


## Bounded Gemini nullable-root schemas (#600)

Explicit strict:false transport additionally accepts two-member type-array roots with null plus one supported concrete type (object, array, string, number, integer or boolean), in either order. Recursive type/keyword/local-reference/expanded-depth<=16/shared20,000-visit bounds still apply; captured schemas remain unchanged on nonstream and native text streams. Root null, malformed type arrays, untyped union/reference roots and strict/tool/Anthropic combinations remain unsupported before credentials. This supersedes prior nullable-root-only rejection, not generated-output validation, null-output guarantees, satisfiability, schema equivalence or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; full #116 and unresolved #7 stay open. See [plan](../docs/plans/600-gemini-nullable-root.md).


## Bounded Gemini union-root schemas (#602)

Explicit strict:false transport additionally accepts untyped anyOf/oneOf roots with 1..16 recursively validated branches and optional root-only $defs. Existing local-reference, expanded-depth<=16 and shared20,000-visit bounds apply across definitions and branch expansion; captured schemas remain unchanged on nonstream/native text streams. Root references, literal root null, malformed/dual unions, nested definitions and strict/tool/Anthropic combinations remain unsupported before credentials. This supersedes prior untyped-union-root rejection, not output validation, satisfiability, oneOf exclusivity (upstream treats it as anyOf), schema equivalence or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; pinned AI SDK strict:true native rejection is unchanged. Full #116 and unresolved #7 stay open. See [plan](../docs/plans/602-gemini-union-root.md).


## Bounded Gemini root local references (#604)

Explicit strict:false transport additionally accepts root $ref plus root-only $defs, without other reference siblings. Simple local names and all definitions (including unused ones), resolved targets, cycles, expanded depth<=16 and shared20,000-visit budget retain the existing recursive subset checks. Captured schemas remain unchanged on nonstream/native text streams; no URL fetching, inlining, output validation, satisfiability, equivalence or live-model certification. Resolved targets can use the existing scalar/object/array/nullable/union/null subset; literal root null remains unsupported. Malformed/dangling/external/escaped references, nested definitions, other siblings and strict/tool/Anthropic combinations fail before secrets. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; actual AI SDK strict:true native rejection remains. This supersedes only earlier root-reference exclusions; full #116 and unresolved #7 remain open. See [plan](../docs/plans/604-gemini-root-local-ref.md).


## Bounded Gemini literal null-root schemas (#606)

Explicit strict:false transport additionally accepts literal type:null roots with existing annotations and optional root-only definitions. All unused definitions, local-reference/cycle checks, expanded depth<=16, shared20,000-visit budget and wrong-type keyword restrictions remain enforced before credentials. Captured schemas pass unchanged on nonstream and native text streams. Null enums, malformed type arrays, nested definitions and strict/tool/Anthropic combinations remain unsupported; actual AI SDK strict:true rejection is unchanged. This supersedes earlier literal-root-null-only exclusions, not generated-output validation, forced-null output, satisfiability, equivalence or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged. Full #116 and unresolved #7 stay open. See [plan](../docs/plans/606-gemini-null-root.md).


## Bounded Gemini definition-local anchors (#608)

Explicit strict:false transport additionally accepts unique 1..64 ASCII $anchor names only on direct root-$defs entries and local #name references to those entries. Pointer and anchor references share canonical definition identity for cycle checks. All unused definitions, expanded depth<=16, shared20,000-visit and 128-definition bounds remain enforced; captured schemas pass unchanged on nonstream/native text streams. Root/nested anchors, anchors on reference nodes, $id, malformed/duplicate/dangling/external/escaped references and strict/tool/Anthropic combinations remain pre-secret failures. No URI fetching, generated-output validation, satisfiability, equivalence or live-model certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged. This supersedes only earlier anchor-only exclusions; full #116 and unresolved #7 remain open. See [plan](../docs/plans/608-gemini-definition-anchors.md).


## Bounded Gemini anchored definition aliases (#610)

Explicit strict:false transport additionally accepts $anchor on direct root-$defs entries containing $ref, enabling named local aliases through existing pointer/anchor resolution. Canonical mixed-alias cycle detection, all unused definitions and expanded depth<=16/shared20,000-visit/128-definition bounds remain enforced. Captured schemas pass unchanged on nonstream/native text streams. Arbitrary reference siblings, root/nested anchors, $id, remote/dangling/malformed references and strict/tool/Anthropic combinations remain pre-secret failures. This supersedes only reference-entry-anchor rejection, not generated-output validation, satisfiability, equivalence or live-provider certification. IAM/limits/accounting/persistence/privacy and deprecated responseJsonSchema transport remain unchanged; full #116 and unresolved #7 stay open. See [plan](../docs/plans/610-gemini-anchored-aliases.md).


## Bounded Gemini dotted anchor names (#612)

Explicit strict:false definition-local $anchor names and named local references additionally allow literal ASCII dots after the initial letter/underscore, retaining 1..64 characters. Dotted direct/alias names transport unchanged on both chat bases, actual OpenAI SDK sockets and native text streams. Definition-key and pointer grammar are unchanged; no percent decoding or path normalization. Duplicate/dangling/malformed names, canonical mixed cycles, unused invalid definitions, root/nested anchors and strict/tool/Anthropic combinations remain pre-secret failures. Existing depth16/shared20,000 visits/128-definition bounds, IAM/limits/accounting/privacy and deprecated responseJsonSchema transport remain. No generated-output validation, equivalence or live compatibility certification. Full #116 and unresolved #7 stay open. See [plan](../docs/plans/612-gemini-dotted-anchors.md).


## Bounded Gemini dotted definition keys (#614)

Explicit strict:false transport accepts literal ASCII dots after the initial letter/underscore in root-$defs keys and matching #/$defs/name references, retaining 1..64 characters. Direct pointers and named anchor aliases transport unchanged through both HTTP bases, actual OpenAI SDK sockets and native text streams. Dots are literal: no percent decoding, path normalization, JSON Pointer escaping or remote fetching. Canonical mixed cycles, unused definitions, depth16/shared20,000 visits/128 definitions, strict/tool/Anthropic pre-secret rejection and IAM/limits/accounting/persistence/privacy remain enforced. No generated-output validation, equivalence, live-model or operational certification. This supersedes only the earlier dotted-definition-key exclusion; full #116 and unresolved #7 remain open. See [plan](../docs/plans/614-gemini-dotted-definition-keys.md).


## Bounded Gemini root identity (#616)

Explicit strict:false Gemini schemas may carry root-only $id metadata: canonical absolute HTTPS URL, at most 2048 characters, no credentials, query or fragment. URL parsing validates without rewriting the captured value. Typed, union and local-reference roots preserve identity unchanged. All supported literal fragment references resolve only against the captured root $defs; identity is never fetched or used as a routing destination. Nested identities, absolute references, noncanonical IDs, dangling/cyclic refs and existing strict/tool/Anthropic exclusions reject pre-secret. Resource/IAM/limits/accounting/privacy bounds remain unchanged. This supersedes only root-$id exclusions, not nested-$id/root-anchor exclusions or output-validation/live-compatibility limits. See [plan](../docs/plans/616-gemini-root-schema-id.md).


## Bounded Gemini root anchor metadata (#618)

Explicit strict:false Gemini schemas may carry root $anchor using the existing 1..64-character ASCII anchor grammar. Root anchors coexist with optional root $id and typed/nullable/union/local-reference roots; duplicate root/definition names reject before credentials. Named root references remain invalid recursive schemas; existing local root-$defs resolution is unchanged, with no fetching or nested-base changes. Immutable both-base HTTP, actual OpenAI SDK sockets and native captured streams retain the metadata. Nested non-definition anchors, malformed/dangling/cyclic refs, unused invalid definitions and strict/tool/Anthropic exclusions remain pre-secret failures. Depth16/shared20,000 visits/128 definitions and IAM/limits/accounting/persistence/privacy bounds remain. This supersedes earlier root-anchor exclusions only, not generated-output validation, equivalence or live/operational certification. Full #116 and unresolved #7 remain open. See [plan](../docs/plans/618-gemini-root-anchor.md).
