# Official schema drift contract

The pin records source URL, retrieval date, canonical source SHA-256 and a canonical structural projection SHA-256. Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), retrieved 2026-10-05 for version 23. The snapshot contains selected schema constraints, with examples/descriptions and other annotations removed.

The offline gate validates provenance shape and projection integrity. `npm run compatibility:drift` explicitly fetches only the official HTTPS URL, rejects redirects, bounds time/body size and compares selected chat request and response definitions. It neither changes the pin nor sends credentials or inference calls. Failures expose fixed messages, not downloaded content or transport errors.

Selected fields are model, messages, stream, max_tokens, max_completion_tokens, stop, temperature, top_p, response_format, frequency_penalty, presence_penalty, seed and top_k. Version 3 retains exactly ChatFormatTextConfig and ChatFormatJsonObjectConfig; structural changes inside either definition are detected even when their request references remain unchanged. Missing/malformed selected definitions fail safely. Version-1 and version-2 pins are rejected and must be reviewed with the matching projector. Request reference, required field list and document versions are included. Unrelated endpoints and annotation-only changes do not affect comparison. ModelName and unsupported output-format references are not recursively traversed. ChatMessages is now explicitly selected under version 17 below; other unselected referenced definitions remain outside detection.

This is partial structural drift coverage, not JSON Schema instance validation, full response/tool/streaming conformance or external-client certification. The retrieved official ChatRequest has no n property; current n=1 handling is a local/SDK extension. The four nullable token/sampling fields are supported. Optional official model and other broader schema behavior remain gaps in the current local subset.

The reviewed version-3 projection selects thirteen fields and adds a messageNames map. Exact field-map validation rejects stale eleven-field maps even if their hash is recomputed. Integer/nullability/constraint drift for seed/top_k is tracked; source tracking does not assert runtime model support or native provider ranges.

Version 3 adds exactly ChatSystemMessage, ChatDeveloperMessage, ChatUserMessage and ChatAssistantMessage in messageNames. Each entry has only schema (the structural name property) and required (whether the name is required). Source containers must be objects with a name schema; omitted required lists mean optional, while malformed/duplicate required entries fail. Name type/nullability/bounds/literal defaults and required status are tracked independently of unchanged message references. Annotation and unrelated content/role schema changes are ignored. Rehashed missing/extra/malformed maps and older pins reject safely. This historical name-only subset was later supplemented by the explicit version-17 ChatMessages and full instruction/user selections below; it does not certify all recursive references.

Version 4 adds the tools, tool_choice and parallel_tool_calls request fields; ChatFunctionTool, ChatToolChoice, ChatNamedToolChoice and ChatToolCall definitions; the assistant tool_calls property and required status; and the entire ChatToolMessage schema. These structures detect upstream changes to the currently supported non-streaming function-tool flow. Full ChatFunctionTool and ChatToolChoice union shapes are selected, including references to server-tool alternatives, but referenced server-tool definitions are not traversed. Missing or malformed selected structures reject safely. Editorial annotations and unrelated definitions remain ignored. Version-3 pins are rejected. This guard does not make unsupported server tools or streaming available at runtime.

Version 5 adds a separate exact `streamDefinitions` map for ChatStreamChunk, ChatStreamChoice, ChatStreamDelta and ChatStreamOptions. Structural and required-list changes to these selected response definitions cause drift even when references elsewhere stay unchanged. Missing, extra or malformed maps reject even with a recomputed projection hash; editorial annotations and unrelated schemas are ignored. Referenced audio, tool, reasoning, error and usage definitions are not recursively traversed. This guard does not validate streamed JSON instances or enable a client streaming route. Version-4 pins are rejected.

Version 6 adds the selected ChatRequest.stream_options reference. The 2026-10-02 source also adds ChatDynamicServerTool to ChatFunctionTool.anyOf; this reviewed source alternative remains outside the bounded local function-tool subset and is rejected. All other previously selected structures remain unchanged. This pin refresh does not enable dynamic or server tools.

Version 7 adds ChatRequest.logit_bias as the eighteenth selected request field. The 2026-10-02 explicit refresh preserves all seventeen prior fields and existing definitions/maps unchanged. Nullable object and number/double additionalProperties, future key/count/value constraints and literal defaults are structural data; annotations remain ignored. Exact-map validation and integrity reject missing/extra/malformed fields and versions 1 through 6, even with a recomputed projection digest. Runtime/native model behavior and full instance validation remain outside this structural gate. See [plan](../docs/plans/220-logit-bias-schema.md).

Version 8 adds ChatFinishReasonEnum to the exact selected definitions map, increasing it from six to seven while preserving all eighteen request fields and existing streaming/message structures. Both ChatChoice and ChatStreamChoice reference this common definition. The reviewed source includes tool_calls, stop, length, content_filter, error and null, string/null type and x-speakeasy-unknown-values:allow. Enum membership, type/nullability, structural constraints, that extension and literal defaults cause drift even if the reference remains unchanged. Editorial annotations and unrelated definitions remain ignored.

Missing/malformed source definitions and rehashed missing/extra/malformed selected maps fail safely; versions 1 through 7 reject. The source canonical digest is unchanged from version 7; the reviewed projection digest reflects only the added definition. This does not change supported runtime finish reasons, native mapping, SDK behavior or complete response-instance validation. Source checks never update the pin automatically. See [plan](../docs/plans/236-finish-reason-schema.md).


## Nonstream response source drift

Version 9 adds the fixed /chat/completions HTTP 200 application/json responseRef, #/components/schemas/ChatResult, and an exact responseDefinitions map containing ChatResult, ChatChoice and ChatAssistantMessage. Whole selected structural shapes track required fields, types/nullability, references, constraints, extensions and literal defaults; editorial annotations remain ignored. Assistant content and other formerly unselected assistant properties now cause drift, while unrelated instruction-message properties remain unselected. Missing/malformed paths or definitions and rehashed missing/extra/malformed maps fail safely; versions 1..8 reject. The explicit refresh preserves every version-8 projection and its canonical official source digest. References to ChatUsage, rich content, audio/images and reasoning-detail definitions are not recursively traversed. Selection does not assert runtime support for all selected fields or JSON-instance validation. See [plan](../docs/plans/242-response-schema.md).


## Chat usage source drift

Version 10 adds exactly ChatUsage, CostDetails and ServerToolUseDetails in usageDefinitions. Both selected nonstream and stream response structures reference ChatUsage, whose prompt/completion token details are inline and whose two referenced detail definitions are included explicitly. Required counters, type/nullability, bounds, cost formats, references and literal defaults cause drift without reference changes; editorial annotations and unrelated/native usage definitions remain ignored. Missing/malformed source definitions and rehashed absent/incomplete/extra/malformed maps fail safely; versions 1..9 reject. All version-9 projections and the canonical official source digest are unchanged. This does not project new runtime usage fields, enable server tools, change estimation or billing, or validate response instances. See [plan](../docs/plans/244-usage-schema.md).

## Min-p request source drift

Version 11 adds optional nullable min_p as the nineteenth selected request field. The reviewed official shape is number/null with double format, without encoded bounds or default. Future type/nullability/format, constraint and literal default changes cause drift; editorial annotations remain ignored. Missing/malformed source fields, rehashed missing/extra/malformed field maps and versions 1..10 reject safely. The explicit refresh preserves every version-10 selection and the canonical official source digest. This source guard does not change runtime validation, provider capabilities, IAM, secrets, usage or audit behavior. See [plan](../docs/plans/254-min-p-schema.md).

## Top-a request source drift

Version 12 adds optional nullable top_a as the twentieth selected request field. Its reviewed official shape is number/null with double format and no encoded bounds/default. Structural constraints and literal defaults cause drift; editorial annotations remain ignored. Missing/malformed sources, rehashed invalid field maps and versions 1..11 reject. All version-11 selections remain unchanged. The official source digest is explicitly refreshed to f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e after comparing changes outside the selected projection. This guard changes no runtime/provider/security/accounting behavior or complete compatibility claim. See [plan](../docs/plans/258-top-a-schema.md).

## Repetition penalty request source drift

Version 13 adds optional nullable repetition_penalty as the twenty-first request field. Its reviewed official shape is number/null with double format and no encoded bounds/default. Future structural constraints and literal defaults cause drift, while annotations remain ignored. Missing/malformed sources, rehashed invalid exact field maps and versions 1..12 reject safely. All version-12 selections and the canonical official source digest are preserved. Runtime/provider/IAM/secret/usage/audit behavior is unchanged; full compatibility remains open. See [plan](../docs/plans/262-repetition-schema.md).

## Reasoning-effort request field

Version 14 adds optional nullable reasoning_effort with string/null type and enum max, xhigh, high, medium, low, minimal, none, null. Preserve x-speakeasy-unknown-values: allow and the absence of a default. Structural enum/type/nullability/default/required/extension changes cause drift. Missing/malformed sources, invalid exact field maps and versions 1..13 reject safely. All previous selections and source provenance remain unchanged. No runtime/provider/IAM/secret/usage/audit behavior changes. See [plan](../docs/plans/276-reasoning-effort-schema.md).

## Referenced reasoning-detail source drift

Version 15 adds exactly eight reasoningDefinitions for nonstream/stream arrays, their shared union, summary/encrypted/text/server-tool-call variants and ReasoningFormat. Track structure, references, discriminator mappings, required lists, types/nullability, constraints, extensions and literal defaults while ignoring annotations. Missing/malformed source definitions and rehashed invalid exact maps fail safely; versions 1..14 reject. All version-14 selections and source provenance remain unchanged. Existing whole assistant/stream delta selections retain parent field/reference/required tracking. This does not enable runtime reasoning details, server tools, signatures/history, or complete reasoning/client compatibility. IAM, credentials, usage and audit behavior are unchanged. See [plan](../docs/plans/282-reasoning-details-schema.md).

## Referenced JSON-schema format source drift

Version 16 adds exactly ChatFormatJsonSchemaConfig and ChatJsonSchemaConfig to the selected definitions map (nine definitions total). The request response_format union already tracks parent references/discriminator mappings. Wrapper type enum, inner reference, required lists, name maxLength, description type, schema object/additionalProperties and strict boolean/null shape now cause drift even with unchanged parents. New structural constraints and literal defaults also cause drift; editorial annotations remain ignored, while annotation-like property names and literal data remain preserved.

Missing/malformed source definitions and rehashed missing/extra/malformed exact maps reject safely; versions 1..15 reject. Explicit fixed-host retrieval preserves every version-15 selection and the canonical source digest f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e. The reviewed projection digest is 48937004d7e679a75bf61a6775716898b1a5b93d0875b041f8cf23f970a3e2f0. Offline validation does not fetch or rewrite the pin; explicit live comparison remains credential-free and bounded.

The official config requires only name and permits omitted schema; runtime #297 deliberately requires a schema object. Official name character guidance is prose stripped as an annotation, with no encoded pattern/minLength. This gate tracks structural constraints, not changes in that prose guidance, and does not enable additional runtime fields or promise local JSON-instance/output validation. Other referenced formats, native mappings and full external-client certification remain open. See [plan](../docs/plans/298-json-schema-drift.md).

Runtime #300 now also preserves the official optional schema omission. The version-16 source projection is unchanged; this runtime extension does not add instance/output validation. See [omission plan](../docs/plans/300-optional-config-schema.md).

## Referenced message history definitions

Version 17 adds exactly ChatMessages, ChatSystemMessage, ChatDeveloperMessage and ChatUserMessage to the selected definitions map (thirteen total). Track the five-role oneOf sequence, discriminator role mappings, complete system/developer/user role/content/name/required shapes, configuration_update and nested references, constraints, extensions and literal defaults. Assistant/tool full shapes remain selected through responseDefinitions and toolMessages; all prior maps/fields retain identical structures. Annotation-only changes stay ignored while annotation-named properties and literal data remain structural.

Missing/malformed selected source containers, invalid rehashed exact maps and versions 1..16 reject. This is explicit structural selection, without recursive ChatContentText/ChatContentItems/ConfigurationUpdateReasoning traversal or full JSON-instance validation. Selecting configuration_update does not accept it at runtime; current strict client boundaries still reject unsupported configuration and rich content. No model/provider/IAM/credential/usage/audit behavior changes.

The explicit 2026-10-04 fixed-host refresh preserves every version-16 selection. The canonical source hash changes from f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e to b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5. Reviewed differences are outside selected chat structures: new Models API v2 paths and 26 definitions, unselected Responses/default-parameter/provider metadata nullable flags, audio provider-field changes, parameter nullability/SDK-name overrides and tags. No changes are silently accepted into existing selected structures. Projection hash: 4f1702e90cb64cabcd243990240bde731276eed2e9f725a3d8e30eb4e364955d.

Offline validation neither retrieves nor rewrites the pin; explicit live comparison remains bounded and credential-free. Runtime history support follows its separate contracts, and complete #116 certification remains open. See [plan](../docs/plans/308-message-history-schema.md).

## Reasoning summary request selection

Version 18 adds the whole ChatRequest.reasoning field and exactly ChatReasoningSummaryVerbosityEnum to the main definition map, yielding 23 fields and 14 definitions. The inline object includes optional effort and summary; summary references a string/null enum auto/concise/detailed/null with x-speakeasy-unknown-values:allow and no default. Track summary references, enum membership, type/nullability, constraints, required lists, literal defaults and extensions while ignoring editorial annotations. Annotation-named properties and literal default data remain structural. Changes are detected even when ChatRequest and summary references stay unchanged.

Missing/malformed selected source containers, rehashed missing/extra/malformed exact maps and versions 1..17 reject safely. Explicit fixed-host credential-free retrieval preserves every version-17 selection and canonical source digest b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5. New projection digest: 70f384c2ab341bdca6a0ae570938540c714d9e89fec499e7e748bfba33f096a3. Offline checks never retrieve or rewrite the pin.

Whole inline effort selection does not enable nested effort, infer alias precedence or alter runtime/provider/IAM/secrets/usage/audit behavior. Runtime summary remains its bounded named-value subset; source open enums do not widen accepted requests. This structural guard does not certify JSON instances, model capabilities or complete #116 compatibility. See [plan](../docs/plans/312-reasoning-summary-schema.md) and [runtime contract](client-reasoning-summary.md).

Runtime #314 now supports the bounded delegated nested effort subset; structural pin v18 is unchanged. Alias differing-value guidance is prose stripped as an annotation and is not covered by structural drift alone. See [runtime contract](nested-reasoning-effort.md).

Documented boolean exclusion is implemented by [its separate HTTP contract](client-reasoning-exclusion.md). Current official reasoning structure and SDK omit exclude; unchanged v18 selects the official object but cannot certify the absent extension. No invented source field or fresh full-source comparison is asserted by this runtime change.

Documented boolean activation follows [its separate HTTP contract](client-reasoning-activation.md). Current official reasoning shape and SDK omit enabled; unchanged v18 cannot certify this absent extension and no source shape is invented.

Documented reasoning budget follows [its separate HTTP contract](client-reasoning-budget.md). Current official reasoning shape and SDK omit max_tokens; unchanged v18 cannot certify the absent child field and no source/default/bounds are invented.

Legacy inclusion normalization follows [its separate HTTP contract](client-legacy-reasoning.md). Current official ChatRequest and SDK omit include_reasoning despite its parameter-catalog name; unchanged v18 cannot certify the absent flag or prose alias rules.

[No-text length responses](no-text-length.md) use the already-selected optional nullable assistant content shape; v18 is unchanged and no fresh full-source comparison is claimed by this runtime slice.

[Optional stop content](no-text-stop.md) uses the already-selected nullable assistant shape; v18 is unchanged, source rules are not fabricated and no fresh full-source comparison is claimed.

## Streamed function fragment target (version 19)

The exact stream map adds ChatStreamToolCall, including required index and optional
id, function type, and inline function name/arguments. Unchanged parent references
cannot hide nested structural drift. Rehashed missing/extra/malformed maps and stale
versions reject. Annotations remain ignored; runtime caps are local restrictions.
The cached 2026-10-04 canonical source digest remains b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5;
this expands the projection without claiming a fresh retrieval. Projection digest:
5a755dd0e25db8752dfd48b8a74ab98344e8498f9c0d925ccbb3effed689a55c. All other selections remain unchanged.

## Chat probability targets (version 20)

Add exactly logprobs/top_logprobs and whole ChatTokenLogprobs/ChatTokenLogprob to the response map (25 fields/five response definitions); retain every previous selection. Nested token bytes and inline alternative structures cannot hide behind unchanged choice references. Stale versions and rehashed invalid exact maps reject; editorial annotations remain ignored while literal data stays structural. Do not manufacture source constraints from runtime/prose rules. Fresh canonical source/projection digests and bounded facts are recorded in [plan](../docs/plans/422-logprob-schema.md) and [contract](logprob-schema.md). Runtime support remains its separate subset.

Issue #428 extends the pin to version 21 with exactly 26 request fields, adding the optional non-nullable user schema. Every earlier selected definition/map remains unchanged. User structural changes and required-status drift are guarded without inventing runtime limits or authenticating the identifier. See [client-user](client-user.md) and [plan](../docs/plans/428-client-user.md).

Issue #430 extends the pin to version 22 with exactly 27 request fields, adding nullable string prompt_cache_key while retaining all prior definitions/maps. Detect structural and required-status drift without inventing cache guarantees, counters or bounds. See [prompt-cache-key](prompt-cache-key.md) and [plan](../docs/plans/430-prompt-cache-key.md).

Version 23 adds only metadata as the twenty-eighth selected request field. Preserve exact object/string additionalProperties; 16/64/512 prose bounds are not schema constraints. Nullable/type/nested-value/required/default/bounds/extension drift is detected; missing/malformed targets and stale/rehashed invalid exact maps reject. Removing metadata reproduces version 22 canonically, including every prior field/definition/map. Official source SHA-256 remains 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection SHA-256 is 02b10bb1c040cd9141a520c0622122f70c684cfd8d9c92f4433c4675f4a14499. See [plan](../docs/plans/432-client-metadata.md).
