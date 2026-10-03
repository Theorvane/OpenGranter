# OpenRouter external-client compatibility

Tracking issue: [#116](https://github.com/Theorvane/OpenGranter/issues/116).

## Product requirement and release gate

The contributor requires external tools to register and use OpenGranter with OpenRouter-compatible model APIs. Compatibility is a release requirement, covering client registration, discovery, request/response formats, streaming and tool-call workflows across approved delegated and managed destinations. Each supported operation must preserve authentication, IAM, limits, metadata audit and usage accounting. Never declare complete compatibility from a successful text-chat demo.

The current build is partial. The table is an implementation inventory, not a claim that missing capabilities are optional. Provider-specific native APIs remain a separate scope.

## External-client configuration

For tools supporting a configurable OpenRouter/OpenAI-compatible endpoint:

- Base URL: `https://<gateway-host>/api/v1` (existing `/v1` also remains available).
- API key: the user's OpenGranter proxy token; provider keys stay server held.
- Model: an administrator-published alias visible to that token. An OpenRouter-style alias such as `openai/example-model` must be explicitly published; arbitrary model IDs do not become eligible.
- Current text-chat request: model plus string-content messages (exact text-part arrays on supported roles also normalize to strings), optional stream false (or true for the delegated text-stream subset), optional n=1 and positive-integer max_tokens or max_completion_tokens and optional stop (string or up to four strings), optional top_p (finite number in 0..1), and optional temperature (finite number in 0..2; direct Anthropic 0..1). Discovery uses GET models; chat uses POST chat/completions relative to the base.

Tools with a hardcoded openrouter.ai host need a configurable endpoint or an integration change. Path aliases alone do not make tools needing streaming, function calls or advanced parameters work.

## Compatibility matrix

| Area | Current state | Remaining acceptance gate |
| --- | --- | --- |
| Base paths and Bearer token | /api/v1 chat/models aliases; shared proxy authorization; pinned OpenAI SDK smoke tests | Direct/tool streaming SDK workflows and named external-tool registration tests |
| Model discovery | IAM-filtered aliases; optional administrator-published complete OpenRouter metadata and bounded offset/limit paging on /api/v1 | Metadata provisioning/refresh, broader filter queries, broader optional fields and complete discovery workflows |
| Non-streaming text chat | Text messages, one normalized text choice with max_tokens/max_completion_tokens and portable stop/top_p/temperature/n=1 across four adapters | Remaining request/response schema, sampling and capability metadata |
| Streaming | Delegated HTTP text streams with bounded validation, awaited delivery, cancellation, usage and interruption audit | Direct-provider/tool/multimodal mappings, additional stream option fields, incomplete usage and full external-client conformance |
| Tool calling | Validated function-tool requests, non-streaming assistant calls and text-only tool-result history for delegated OpenRouter/direct OpenAI | Server tools, rich content, native mappings and streaming |
| Rich inputs and outputs | Text-only parts on system/developer/user/assistant normalize to strings | Multimodal/cached content, native block semantics, structured output and reasoning handling |
| Client routing controls | Rejected today | Client preferences narrow approved model/provider scope; no arbitrary destinations or authority widening |
| Errors | /api/v1 numeric status codes, fixed messages, safe local reason/typed metadata and request ID; legacy /v1 symbolic codes | Precise upstream error_type propagation, retry hints and full provider streaming errors |
| Other model-use endpoints | Not implemented | Inventory completions, responses, embeddings and generation lookup against external-tool requirements and authorization |
| Operational OpenGranter APIs | Usage/audit extensions on /v1 | Keep their authorization and contracts explicit during compatibility expansion |

## Implementation sequence

1. Base paths and an integration harness: this issue.
2. Supported model metadata and standard request controls with provider capability mapping.
3. Tool-call lifecycle and structured output normalization.
4. Streaming across providers with audited interruption and unknown-usage handling.
5. Source-pinned conformance cases plus SDK and named external-tool smoke tests for the supported surface. Compatibility gaps block the release claim.

Every feature needs its own issue, English plan and red/green contract cases. Routing and privileged debug fields must retain the security invariants; accepting arbitrary JSON and forwarding it upstream does not satisfy compatibility.

The first streaming preparation slice parses bounded SSE data events without exposing a streaming client route. It handles line and byte boundaries, comments, multiline data, strict UTF-8, incomplete EOF, backpressure and early reader cancellation. It leaves `[DONE]`, provider chunks, usage and midstream errors to later layers. See [plan](plans/188-bounded-sse-parser.md) and [contract](../contracts/streaming-sse-framing.md).

The next internal decoder classifies individual delegated OpenRouter text chunks, the documented content-free repeated-finish usage chunk, an empty-choice usage compatibility variant, `[DONE]` and top-level midstream errors. It validates selected model scope and rejects malformed, multi-choice, tool and rich deltas with fixed errors. It does not validate sequence, persist usage or emit client SSE. See [plan](plans/190-openrouter-stream-chunks.md) and [contract](../contracts/openrouter-stream-chunks.md).

The internal sequence validator checks stable response identity and client model alias, terminal ordering, final usage and `[DONE]` over decoded text events. It treats upstream errors, malformed order and incomplete streams as possibly billed failures, without retaining response text. It does not integrate transport, accounting, audit or client SSE. See [plan](plans/192-openrouter-stream-sequence.md) and [contract](../contracts/openrouter-stream-sequence.md).

The internal byte-stream consumer composes framing, text-chunk decoding and sequence validation for an already opened upstream stream. It awaits validated delta delivery, stops on `[DONE]` or an upstream error, and converts framing, transport and callback failures into safe possibly-billed failures. It does not yet open the provider request, persist usage/audit or emit client SSE. See [plan](plans/196-openrouter-stream-consumer.md) and [contract](../contracts/openrouter-stream-consumer.md).

The internal HTTP response boundary checks status, SSE media type and body before invoking that consumer. It classifies non-200 responses without reading their bodies and converts incomplete or invalid streams to existing safe delegated failures. It does not issue the HTTP request, write audit/usage or enable a client stream. See [plan](plans/198-openrouter-stream-response.md) and [contract](../contracts/openrouter-stream-response.md).

The delegated OpenRouter request adapter captures the IAM-approved upstream model and final-provider slug set before resolving a credential. Its HTTP body and response-scope check use that immutable attempt, even if a caller-owned object changes during the await. The future streaming request must reuse this boundary. See [plan](plans/200-openrouter-attempt-snapshot.md) and [contract](../contracts/openrouter-attempt-snapshot.md).

The internal delegated text-stream invoker now sends one `stream:true` request to the same fixed endpoint with the same captured model/provider scope and text/sampling request preparation as the non-streaming adapter. It rejects tool controls before credential lookup, awaits validated SSE deltas, and returns final usage only after a complete sequence. The delegated HTTP composition now wires it to both chat paths through shared IAM, limits, accounting and audit; direct/tool streams remain unsupported. See [plan](plans/202-openrouter-stream-invoker.md) and [contract](../contracts/openrouter-stream-invoker.md).

The internal client SSE encoder projects validated text deltas, complete usage and `[DONE]` into OpenRouter-shaped frames using the authorized client model alias. It escapes text within a single data frame and suppresses incomplete usage instead of fabricating counters. This suppression is an explicit gap against OpenRouter's documented final usage frame. The encoder does not validate event order, send HTTP bytes, record usage/audit or enable client `stream:true`. See [plan](plans/204-openrouter-client-sse.md) and [contract](../contracts/openrouter-client-sse.md).

The delegated text-stream composition now runs validated deltas through the existing IAM, verified provider mapping, limit, usage and audit coordinator. It returns usage and `[DONE]` frames only after the success handoff; partial output on later failures has no terminal success frames. The public HTTP writer, client cancellation, post-accounting delivery failures and direct-provider streams remain open. See [plan](plans/206-delegated-text-stream.md) and [contract](../contracts/delegated-text-stream.md).

## Sources checked 2026-09-28

OpenRouter documents /api/v1 with Bearer authentication and configurable SDK base URLs: [authentication](https://openrouter.ai/docs/api_reference/authentication). Its unified chat schema includes additional parameters, tools, richer messages and response fields: [API overview](https://openrouter.ai/docs/api_reference/overview). Streaming uses SSE and has distinct pre-stream and mid-stream errors: [streaming](https://openrouter.ai/docs/api_reference/streaming). The [official OpenAPI specification](https://openrouter.ai/openapi.json) supplies the selected structural drift pin; full instance and client conformance remain open.

## Output-token limit conformance

The current adapters support max_tokens through both client paths, including direct registration caps, omission defaults, malformed-value rejection and captured values during asynchronous credential resolution. See [contract](../contracts/client-output-limits.md) and [plan](plans/118-client-output-limits.md). Full compatibility remains pending.

## Error display conformance

Fixed error.message is available for all gateway failures and the Node bridge fallback. Legacy /v1 symbolic codes remain unchanged; /api/v1 uses numeric HTTP status, metadata.opengranter_code and allowlisted metadata.error_type. Precise upstream error_type propagation, retry hints and streaming errors remain pending. See [contract](../contracts/safe-client-errors.md).

Numeric error envelope conformance is tracked in [plan](plans/122-openrouter-error-schema.md) and [contract](../contracts/openrouter-error-schema.md).

## Stop-sequence conformance

Portable stop strings/lists map across all four adapters without exposing their contents in metadata. Null/omission, bounded dense lists, immutable capture and combined output settings are covered. Provider-specific longer lists and per-model capability handling remain open. See [contract](../contracts/client-stop-sequences.md).

## Completion-token alias conformance

max_completion_tokens maps to the existing output-maximum pipeline across both paths and four adapters. Equal simultaneous maxima are accepted; differing pairs reject as an explicit local restriction rather than claiming undocumented OpenRouter precedence. Native reasoning-model field selection and broader request/model capabilities remain open. See [plan](plans/126-completion-token-alias.md) and [contract](../contracts/client-output-limits.md).

## Temperature conformance

Client temperature maps to native fields across four adapters with omission/capture, combined-stop/output and security/accounting coverage. Client range is 0..2; direct Anthropic enforces 0..1 without clamping. Per-model and paired sampling support remain compatibility gaps. See [contract](../contracts/client-temperature.md) and [plan](plans/130-client-temperature.md).

## top_p conformance

The portable 0..1 top_p field maps across four adapters with omission, captured-value, combined-stop/output and security/accounting cases. Model-dependent sampling restrictions remain open, particularly current Anthropic restrictions; native mapping does not imply universal model support. See [contract](../contracts/client-top-p.md) and [plan](plans/128-client-top-p.md).

## Single-choice and SDK smoke conformance

Optional n=1 maps to the current one-choice contract across four adapters; other counts reject explicitly. Pinned development-only OpenAI SDK 7.23.0 exercises configured baseURL/proxy token, model discovery, text chat and safe failures on loopback gateway sockets. This is partial SDK coverage: streaming, tool workflows, official-schema drift, full response validation and named external applications remain open. See [plan](plans/134-single-choice-sdk.md) and [contract](../contracts/client-single-choice.md).

## Local typed error conformance

Fixed metadata.error_type is available alongside numeric codes and local reasons on compatible paths. Known local causes map to documented vocabulary; dependency failures use server and collapsed provider failures remain unmapped. Precise upstream cause propagation, retry hints and streaming remain open. See [plan](plans/132-typed-client-errors.md) and [contract](../contracts/openrouter-error-schema.md).

## Official request schema drift coverage

A provenance-checked version-7 structural pin covers eighteen source-declared chat request fields, six selected request definitions, four streaming response definitions, four message-name fields and tool-call/result message structures, plus required fields and request reference/document versions. The offline gate checks integrity; an explicit fixed-host network command detects selected structural drift without auto-updating the pin. Other referenced definitions and full schema instance validation remain uncovered. The retrieved ChatRequest does not declare n; local n=1 is SDK support. Optional model and broader source behaviors remain gaps. See [base plan](plans/138-openrouter-schema-drift.md), [tool plan](plans/186-function-tool-schema-drift.md), [stream plan](plans/193-stream-response-schema-drift.md) and [contract](../contracts/openrouter-schema-drift.md).

## Nullable optional chat controls

The four nullable token/sampling controls now enter the existing omission path across both client paths and four adapters. No native null/default is injected. Official model omission, other fields, streaming/tools and complete external-client conformance remain open. See [plan](plans/140-nullable-chat-controls.md) and [output contract](../contracts/client-output-limits.md).

## Upstream single-choice conformance

OpenAI/OpenRouter/Gemini normalize only a validated native singleton rather than truncating alternatives. OpenAI/OpenRouter index must be 0; optional Gemini index is validated. Anthropic multi-block text remains one message. Safe post-response failure accounting remains effective. Multichoice and complete response conformance remain open. See [contract](../contracts/upstream-single-choice.md) and [plan](plans/136-upstream-choice-count.md).

## User text content parts

Text-only content arrays on system/developer/user/assistant are normalized to strings across both external paths and four providers. Native block/cache boundaries are not retained; mixed modalities, tools and streaming remain open. See [plan](plans/144-user-text-parts.md) and [contract](../contracts/client-user-text-parts.md).

## Developer instruction prefix

Leading developer text instructions are supported with immutable capture. OpenAI/OpenRouter preserve roles; Anthropic/Gemini use a combined native instruction field without separate role priority. Mid-conversation instructions, rich/tool messages and full external-client workflows remain open. See [plan](plans/142-developer-messages.md) and [contract](../contracts/client-developer-messages.md).

## Instruction and assistant-history text parts

Both prefixes accept exact text arrays on all four supported roles using literal concatenation. Leading instruction order, immutable capture, strict keys, IAM/limits/audit and safe usage remain enforced across four adapters and actual SDK cases. Native string contracts remain unchanged; block/cache semantics, multimodal/refusal/tool arrays and stream workflows remain open. See [plan](plans/148-message-text-parts.md) and [contract](../contracts/client-user-text-parts.md).

## Non-streaming refusal/filter response subset

OpenAI and delegated OpenRouter preserve optional string/null refusal and content_filter, including null content only when refusal/filter signals justify it. SDK and both-prefix coverage retains security/accounting controls and safe malformed-response failures. Valid refusals are successful deliveries; metadata audit does not record their text. Native Anthropic/Gemini blocked outcomes, tool/stream workflows and complete response-schema coverage remain open. See [plan](plans/146-refusal-outcomes.md) and [contract](../contracts/refusal-outcomes.md).

## Direct Anthropic refusal subset

Explicit non-streaming Anthropic refusal with valid empty/text-only content maps to null-content/content_filter and refusal=null. Partial text and stop_details are not forwarded. Both prefixes, actual SDK, normal text parity, configured backup, usage/missing/invalid accounting and security gates are covered. Rich native blocks, provider billing-category projections, automatic refusal fallback and stream/tool workflows remain incomplete. See [plan](plans/152-anthropic-refusals.md) and [contract](../contracts/anthropic-refusals.md).

## Direct Gemini SAFETY subset

Empty direct Gemini SAFETY prompt/candidate blocks map to null-content/content_filter with success-delivery accounting and no fallback. Both prefixes, actual SDK, usage/missing/invalid accounting, malformed-block and security gate cases are covered. Other native reasons, Anthropic refusals, populated block shapes and tool/stream workflows remain pending. See [plan](plans/150-gemini-safety.md) and [contract](../contracts/gemini-safety.md).

## Frequency and presence penalty subset

Optional nullable penalties in [-2,2] map to OpenAI/OpenRouter native names and Gemini camelCase fields with exact values and omission defaults. Direct Anthropic non-null values fail before credentials/transport. Both paths, SDK, scalar capture, Google standalone settings and security/accounting cases are covered. Per-model support, capability-aware selection and broader sampling/tool/stream conformance remain pending. See [plan](plans/156-penalty-controls.md) and [contract](../contracts/client-penalties.md).
## Portable response-format subset

Exact text/json_object controls are captured and mapped across both paths. OpenAI/OpenRouter forward the format; Gemini maps MIME; Anthropic text uses its default and JSON fails before secret/transport. SDK, omission/capture, combined controls and security/accounting cases are covered. Per-model support, local output validation/repair, JSON schema, native Anthropic JSON, capability selection and full tool/stream conformance remain pending. See [plan](plans/154-response-formats.md) and [contract](../contracts/client-response-formats.md).

## Client top-k subset

Nullable nonnegative safe-integer top_k preserves supplied values/defaults on both bases and SDK serialization. OpenRouter/Anthropic retain the external field; Gemini uses int32-bounded generationConfig.topK and direct OpenAI rejects supplied controls before secrets. Capture, settings-only configuration, malformed inputs and shared security/accounting are covered. Newer Anthropic and model-specific Gemini restrictions remain upstream/model dependent; capability routing and full tool/stream/client conformance remain incomplete. top_k is included in the reviewed thirteen-field source projection; native schema/capability validation remains open. See [plan](plans/162-top-k.md) and [contract](../contracts/client-top-k.md).

## Client seed subset

Nullable safe-integer seed controls preserve omission defaults and values across both client bases and SDK requests. OpenAI/OpenRouter forward seed; Gemini generationConfig.seed is bounded by native signed int32, while Anthropic supplied seeds reject before credentials. Native capture, settings-only configuration and security/accounting paths are covered. Model-dependent support, deterministic output, provider fingerprint metadata and full client/tool/stream workflows remain open. Seed and top_k are now included in the reviewed source-drift allowlist; this does not guarantee runtime model support. See [plan](plans/160-client-seed.md) and [contract](../contracts/client-seed.md).

## Sampling-field source drift

The thirteen-field source projection includes seed/top_k integer/nullability structure and constraints, with missing/malformed/rehashed-map and annotation/unrelated-change coverage. The selected request fields and two format definitions are retained in version 3. Native provider schemas, runtime model support, other references and full instance/response/tool/stream/client conformance remain open. See [plan](plans/164-sampling-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Optional text speaker names

String name is supported on all four existing text roles and normalized text arrays. Both bases and SDK preserve exact OpenAI/OpenRouter names with immutable capture; direct Anthropic/Gemini reject supplied names before credentials. Names cannot override authenticated authority or accounting identity and stay out of metadata audit/errors. Native named-speaker semantics, other referenced-message fields and full tool/multimodal/stream/client workflows remain open. See [plan](plans/166-message-names.md) and [contract](../contracts/client-message-names.md).

## Referenced message-name source drift

The message-name subset introduced in version 3 remains selected in version 7. Malformed source containers, required lists and rehashed maps fail safely. Annotation and unrelated message-field changes are ignored. Full ChatMessages traversal, other fields and instance/stream/response conformance remain open. See [plan](plans/168-message-name-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## System fingerprint subset

Direct OpenAI and delegated OpenRouter preserve supplied string/null system_fingerprint, including normal/refusal/filter outcomes and SDK paths. Malformed fields fail safely with post-response accounting; native Anthropic/Gemini do not fabricate metadata. Fingerprints stay out of operational metadata and cannot establish authority, provider identity or deterministic output. Delegated text streaming also preserves validated chunk metadata and the actual usage-event fingerprint; null is a local OpenAI compatibility allowance. Direct/tool streams, full validation and other response metadata remain open. See [stream plan](plans/216-stream-fingerprints.md), [stream contract](../contracts/stream-fingerprints.md) and [plan](plans/170-system-fingerprint.md) and [contract](../contracts/system-fingerprint.md).

For normalized nonstream completions on /api/v1, an unavailable system_fingerprint is projected as null after required accounting and audit. Actual socket regressions with official OpenRouter SDK 1.4.18 accept managed OpenAI and delegated OpenRouter responses with unknown fingerprints. Native Anthropic/Gemini responses also receive this compatible null marker; native adapters and /v1 retain omission. Supplied values, SSE, errors and opaque generic responses remain unchanged. This repairs one required nullable response field, not full SDK certification: discovery metadata, sparse usage and other streaming/client cases remain separate work. See [plan](plans/226-compatible-fingerprint-null.md) and [contract](../contracts/compatible-completion-fingerprints.md).

## Function invocation response normalization

OpenAI/OpenRouter now preserve valid non-streaming function tool-call responses with matching tool_calls finish reason. Malformed, mismatched or legacy invocations still fail safely rather than dropping semantics. No-invocation defaults preserve ordinary text/refusal/filter outcomes; safe failure accounting and shared security controls remain covered. Text-only tool-result continuation is supported separately; broader tool compatibility remains open. See [plan](plans/182-function-tool-responses.md) and [contract](../contracts/function-tool-responses.md).

## Non-streaming finish reason validation

OpenAI/OpenRouter preserve stop/length/content_filter/explicit null. Unsupported/error/malformed/missing reasons now fail safely instead of being collapsed into successful null outcomes. Both SDK bases, ordinary/refusal/filter responses, shared denial controls and failed-attempt accounting are covered. Native mappings, full response-schema validation, tool/stream support and precise upstream error categories remain separate. See [plan](plans/174-upstream-finish-reasons.md) and [contract](../contracts/upstream-finish-reasons.md).

## Direct native stop reason validation

Anthropic end_turn/stop_sequence/max_tokens and Gemini STOP/MAX_TOKENS map to the supported stop/length text subset. Existing bounded refusal/SAFETY mappings stay intact. Other, malformed or missing native reasons now fail safely rather than reporting successful null-finish text. HTTP/SDK bases, failed-attempt accounting and shared security gates are covered. Other native blocked outcomes, tools, streams and complete response/client conformance remain open. See [plan](plans/176-native-stop-reasons.md) and [contract](../contracts/native-stop-reasons.md).

## Nullable client logit-bias subset

Omitted/null or exact finite numeric maps enter both compatible paths and SDK serialization. OpenAI/OpenRouter forward captured maps; direct Anthropic/Gemini reject non-null maps before secrets. IAM/limits/audit and usage attribution remain shared, with malformed inputs and failed attempts safely accounted for. The reviewed version-7 source-drift pin selects this official field; native model ranges and full tool/stream/client conformance remain open. See [plan](plans/178-client-logit-bias.md) and [contract](../contracts/client-logit-bias.md).

Validated non-streaming function-tool request controls pass through both compatible paths and the installed OpenAI SDK to delegated OpenRouter/direct OpenAI. Malformed and server-tool requests reject before route lookup; direct Anthropic/Gemini reject supplied controls before credentials. Valid assistant function-call responses preserve IDs, names, serialized arguments and matching finish reason; malformed, duplicate, mismatched or legacy calls fail with safe possible-billing accounting. Streaming, rich content, server tools and native mappings still block full compatibility. See [request plan](plans/180-function-tool-requests.md), [response plan](plans/182-function-tool-responses.md) and [response contract](../contracts/function-tool-responses.md).

## Client socket cancellation prerequisite

The Node bridge propagates interrupted uploads and premature response disconnections through Request.signal and preserves progressive backpressure-aware response delivery. The delegated HTTP text composition now observes that signal through upstream cancellation and separate interruption audit; direct/tool streaming remains open. See [plan](plans/208-http-client-disconnection.md) and [contract](../contracts/http-client-disconnection.md).

## Internal upstream cancellation prerequisite

The delegated text-stream invoker accepts a per-call abort signal, combines it with timeout, prevents cancelled pre-dispatch HTTP and terminates stalled SSE reads. Dispatched cancellation remains possibly billed with existing failed-attempt accounting and no replay. The delegated HTTP handler now supplies that signal and supports text streaming with interruption metadata and safe midstream errors; direct-provider cancellation remains open. See [plan](plans/210-openrouter-stream-cancellation.md) and [contract](../contracts/openrouter-stream-cancellation.md).

## Delegated client HTTP text streaming subset

Both bases accept delegated text-only stream:true with a configured trusted port; PostgreSQL dual composition supplies it. IAM, final-provider scope, limits, attempt usage and audit remain shared. Bounded delivery propagates request/body cancellation and uses safe JSON errors before frames or fixed SSE errors afterward, without terminal success on failure. Separate interruption metadata preserves accounted upstream success after delivery loss. Direct/tool/multimodal streams, additional stream option fields, incomplete final usage and named external-tool workflows remain gaps. See [plan](plans/212-delegated-http-stream.md) and [contract](../contracts/delegated-http-stream.md).

## Bounded stream usage options

Both bases accept nullable stream_options and exact optional boolean include_usage on delegated streams. The official [OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02, marks that flag deprecated with no effect: false preserves final usage and all shared accounting/security gates. Non-null nonstream options reject as a local restriction; unknown options, direct/tool streams and missing final usage remain gaps. Version 6 selects the request field plus nested option structure. See [plan](plans/214-stream-usage-options.md) and [contract](../contracts/stream-usage-options.md).

## Delegated streaming fingerprint subset

Both bases and pinned SDK streamed chunks preserve opaque system_fingerprint string/null/omission, including independently supplied final usage metadata. The official OpenRouter stream schema selects strings; null is a local compatibility allowance. Malformed values fail safely with possible-billing accounting. Fingerprints stay outside IAM, limits, audit and ledger metadata, and missing token counters still yield no fabricated final usage frame. Other metadata, direct/tool/multimodal streams and full client conformance remain open. See [plan](plans/216-stream-fingerprints.md) and [contract](../contracts/stream-fingerprints.md).

## Pinned official OpenRouter SDK subset

Development-only @openrouter/sdk 1.4.18 runs twelve actual socket tests across both bases, through the real HTTP/Node boundary and delegated invoker with fixed-host fake upstream transport. Stream text/complete or unknown usage, portable serialized controls, supplied nonstream fingerprints, authorization/limit status and failed accounting are covered. No live inference or production dependency is added.

Compatible nonstream unknown fingerprints now deserialize as null. Actual SDK validation still rejects legacy omitted fingerprints, the current basic discovery catalog and legacy standalone midstream errors. Compatible /api/v1 midstream errors now deserialize as yielded error chunks with finishReason:error followed by EOF; callers must inspect their error fields. The official stream schema also rejects the gateway's local null fingerprint allowance. Tests recording gaps are an inventory and must evolve with implementing features, not certification of full compatibility. Named external-tool workflows, trusted model metadata, richer/direct/tool streams and complete conformance remain open. See [plan](plans/224-official-sdk.md) and [contract](../contracts/official-openrouter-sdk.md).

## Compatible midstream error subset

Started /api/v1 delegated failures now use delivered chunk identity and finish_reason:error alongside existing fixed numeric errors. Pre-frame JSON and legacy /v1 remain unchanged. EOF/no DONE, required accounting/audit and cancellation controls stay shared. Raw upstream error propagation, precise retry types and complete client conformance remain gaps. See [plan](plans/222-midstream-error-chunks.md) and [contract](../contracts/midstream-error-chunks.md).

Actual SDK validation rejects omitted nonstream fingerprints, the current basic discovery catalog and standalone midstream error envelopes. The pending compatible error PR addresses the last gap; the official stream schema also rejects the gateway's local null fingerprint allowance. Tests recording gaps are an inventory and must evolve with implementing features, not certification of full compatibility. Named external-tool workflows, trusted model metadata, richer/direct/tool streams and complete conformance remain open. See [plan](plans/224-official-sdk.md) and [contract](../contracts/official-openrouter-sdk.md).

## Delegated streaming refusal subset

Both chat bases support validated optional string/null refusal deltas and content_filter termination without fallback/replay. JSON framing preserves exact response text, with safe malformed-value failures and shared security/accounting controls. Usage-only events cannot discard substantive refusal text; missing usage remains unknown. Direct/tool/multimodal streams, structured reasoning and full external-client conformance remain open. See [plan](plans/218-stream-refusals.md) and [contract](../contracts/stream-refusals.md).

## Logit-bias source drift subset

Version 7 selects nullable logit_bias object/numeric-map structure as the eighteenth request field. Nullability, numeric type/format, key/count/value constraints and literal defaults cause drift; editorial annotations remain ignored. Exact-map/integrity gates reject malformed/rehashed/stale pins. Existing selected structures are unchanged. Runtime behavior, provider capability certification, full instance validation and other compatibility gaps remain unchanged. See [plan](plans/220-logit-bias-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Streaming native finish reason coverage

Delegated text streaming preserves exact optional native_finish_reason string/null on choices through both HTTP bases, including the actual repeated-finish usage event. Final metadata never falls back to earlier deltas, and empty-choice usage supplies none. Incomplete usage remains unknown to clients; malformed metadata fails safely even with incomplete usage. Canonical reasons, IAM, limits, required usage/audit gates and operational secrecy remain unchanged. Ordinary and terminal chunks, safe first/later failures, denial paths and actual OpenAI SDK retention are covered by [contract](../contracts/stream-native-finish-reason.md) and [plan](plans/266-stream-native-reason.md). Current official ChatStreamChoice and the pinned OpenRouter SDK omit this extension; SDK stripping and source coverage remain explicit gaps. Managed/tool streaming, full instance conformance and release gate #116 remain open.

## Delegated verbosity coverage

Both chat bases accept optional nullable verbosity with low/medium/high/xhigh/max for delegated nonstream and text streaming. Capture and forward supplied values exactly without defaults; null is a local omission allowance. Invalid values reject before routing, and native Google Gemini rejects supplied non-null values before credentials; direct OpenAI supports low/medium/high and Anthropic maps all five levels to effort. Existing IAM, limits, required accounting/audit, fixed destination scope and operational secrecy remain unchanged. Public HTTP, immutable request, tool-history and SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/268-client-verbosity.md). Current official ChatRequest and pinned OpenRouter SDK omit this documented field; SDK stripping, native capability mappings and source drift selection remain explicit gaps. No complete compatibility claim; release gate #116 remains open.

## Direct OpenAI verbosity coverage

Registered direct OpenAI nonstream chat forwards optional low/medium/high verbosity at top level on both HTTP bases. Null/omission inject no field/default; xhigh/max on direct OpenAI and non-null Gemini values reject before credentials; Anthropic maps all five levels to effort. Exact capture, sampling/output/tool controls, IAM, limits, required ledger/audit and safe possibly-billed failures remain effective. HTTP and actual SDK cases are covered by [contract](../contracts/client-verbosity.md) and [plan](plans/270-openai-verbosity.md). Model capability differences, Google mapping, native thinking/rich responses, managed streaming and OpenRouter source/SDK gaps remain explicit. Depends on PR #269; release gate #116 remains open.

## Direct Anthropic verbosity coverage

Registered direct Anthropic nonstream chat maps optional low/medium/high/xhigh/max verbosity to output_config.effort through both HTTP bases. Null/omission inject no output_config/default; no beta header or thinking configuration is added. Preserve native output caps, sampling/instruction translation, immutable capture and IAM/limits/required ledger/audit controls. Model support differs; existing non-text/thinking blocks still fail safely with possibly-billed accounting. Tests cover HTTP, actual compatible SDK sockets and that response limitation. See [contract](../contracts/client-verbosity.md) and [plan](plans/272-anthropic-verbosity.md). Depends on #271/#269; Google/native stream/thinking response/source/SDK compatibility and release gate #116 remain open.

## Delegated reasoning effort coverage

Both chat bases accept optional nullable reasoning_effort with max/xhigh/high/medium/low/minimal/none for delegated nonstream and text streaming. Capture and forward exact supplied values without defaults; approved model/provider scope, IAM, limits, output controls and required accounting/audit stay unchanged. Invalid values reject before routing, while direct Anthropic and unsupported Gemini values reject before credentials; direct OpenAI and the bounded Gemini subset map native fields. Actual SDK mapping and public-boundary cases are covered by [contract](../contracts/client-reasoning-effort.md) and [plan](plans/274-reasoning-effort.md). Fresh official OpenAPI and pinned SDK include max, unlike the shorter parameter overview. Structured reasoning, other native mappings, richer request/history/response and structural drift selection remain explicit gaps; request forwarding alone does not certify full reasoning compatibility. The direct OpenAI extension depends on PR #275; release gate #116 remains open.

## Direct OpenAI reasoning effort

Direct OpenAI forwards optional none/minimal/low/medium/high/xhigh/max as native reasoning_effort on nonstream requests through both bases. Null/omission inject no field or default; capture occurs once before credentials. Anthropic and unsupported Gemini non-null values reject before secrets, and managed streaming remains unsupported. IAM, Deny, limits, required audit/ledger and safe possibly-billed errors retain existing behavior. Model support/defaults differ; forwarding does not certify native reasoning response/history/usage capabilities or structured reasoning. See [plan](plans/278-openai-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).

## Direct Gemini thinking levels

Direct Gemini maps optional minimal/low/medium/high to generationConfig.thinkingConfig.thinkingLevel without changing maxOutputTokens or other native settings. Null/omission add no thinking config/default; none/xhigh/max reject before credentials. No budget or nearest-level alias is invented. Models support different levels and Gemini 2.5 requires separate budgets; upstream capability rejection remains safely accounted. Returned thought:true or malformed thought flags fail safely instead of merging thinking into visible text; absent/false flags retain ordinary text behavior. IAM, Deny, limits, required audit/ledger and billing uncertainty remain shared. Thinking signatures/history/token details and managed streams remain gaps. Anthropic reasoning-effort mapping and its interaction with verbosity remain unresolved. See [plan](plans/280-gemini-reasoning-effort.md) and [contract](../contracts/client-reasoning-effort.md).


## Trusted model discovery subset

Optional administrator-published complete snapshots in the PostgreSQL catalog provide bounded OpenRouter model fields on /api/v1/models. The official SDK 1.4.18 now deserializes configured rich model lists and empty IAM-filtered lists over actual sockets; the page result retains exact context/price/moderation values. Legacy /v1 and unconfigured aliases retain basic behavior and documented SDK gaps. Filtered total_count and continuation links do not expose denied entries. Strict validation and deep capture preserve required audit, no upstream/secrets/limits/usage calls, and safe malformed-catalog failures.

Configured metadata supports the model response schema and bounded offset/limit iteration through the official SDK, including terminal empty pages. Administrator review/refresh, conservative multi-candidate metadata, publication APIs, broader optional fields, source-pinned model schema tracking and broader query filters remain separate work. Unconfigured aliases still lack required SDK metadata; complete discovery workflows remain unverified. Prices are advertised metadata, not billed cost. See [metadata plan](plans/228-discovery-metadata.md), [metadata contract](../contracts/model-discovery-metadata.md) and [paging contract](../contracts/model-list-paging.md).

## IAM-filtered model paging subset

/api/v1/models supports strict bounded offset/limit after complete-catalog validation and shared IAM filtering. Defaults0/500, limit1..1000, no-query full lists, visible total_count and fixed relative links match the reviewed bounded model-list behavior. Actual SDK 1.4.18 iteration is verified for small/default pages, null offset, exact multiples/terminal empty requests and a 501-model unpaged initial list. Legacy queries and other filters remain rejected. Current authorization is reevaluated for every page; denied metadata/counts stay hidden, and audit/immutable capture/no inference-side effects remain shared. No cross-request snapshot or full conformance claim is made. See [plan](plans/230-model-list-paging.md) and [contract](../contracts/model-list-paging.md).

## Official SDK non-streaming function-tool subset

Sixteen actual socket cases verify SDK 1.4.18 declarations/choice serialization, exact assistant function calls and a second text-result request through both bases and delegated OpenRouter/direct OpenAI. Follow-ups reevaluate authentication/IAM/limits/audit, retain separate attempt usage and keep tool content out of operational metadata. Malformed upstream calls and post-response audit failures remain safe failures. Streaming/native/server tools, rich results, automatic execution and named external-client workflows remain open. See [plan](plans/234-official-sdk-tools.md) and [contract](../contracts/official-sdk-tools.md).

## Referenced finish-reason source drift subset

Version 8 selects the common ChatFinishReasonEnum definition referenced by non-streaming and streaming choices. Enum/type/nullability, constraints, literal defaults and the unknown-value extension now cause drift without a reference change. All prior selected structures and the canonical official source hash remain unchanged. Runtime accepted reasons, native mappings, full response-instance validation and complete client conformance remain separate. See [plan](plans/236-finish-reason-schema.md) and [contract](../contracts/openrouter-schema-drift.md).


## Delegated streaming reasoning text subset

Both bases preserve optional string/null reasoning through bounded delegated streams and actual SDK 1.4.18 validation. Decoder/encoder checks, safe framing/failure, existing IAM/limits/usage/audit and cancellation controls remain shared; reasoning never enters operational metadata or completed summaries. Final usage cannot discard substantive reasoning or replay earlier text. reasoning_details/encrypted formats, request controls, non-streaming/native reasoning and full external-client conformance remain open. The existing ChatStreamDelta source pin already selects this field. See [plan](plans/238-stream-reasoning.md) and [contract](../contracts/stream-reasoning.md).

## Non-streaming reasoning text subset

Already-valid direct OpenAI/delegated OpenRouter assistant responses preserve optional reasoning string/null through both bases and actual SDK 1.4.18 sockets. Current text/refusal/tool validation, IAM/limits, required accounting/audit and safe failed-attempt semantics stay shared; reasoning never enters operational metadata and missing usage stays unknown. Reasoning-only null/missing-content success, reasoning_details/encrypted blocks, request/history controls, native mappings and full external-client conformance remain open. See [plan](plans/240-nonstream-reasoning.md) and [contract](../contracts/nonstream-reasoning.md).


## Nonstream response source drift

Version 9 tracks the official successful nonstream response reference plus ChatResult, ChatChoice and ChatAssistantMessage structures. Required fields, nullability, references and structural constraints cause drift; annotations remain ignored. Previously selected structures and source digest are unchanged. This is structural source tracking, not runtime certification or recursive usage/rich-content/reasoning-detail conformance. Release gate #116 remains partial. See [plan](plans/242-response-schema.md) and [contract](../contracts/openrouter-schema-drift.md).


## Chat usage source drift

Version 10 selects ChatUsage, CostDetails and ServerToolUseDetails, including inline token details, as bounded structural source coverage shared by chat and stream responses. Source selection does not imply runtime support for every field, server tools or complete usage/SDK conformance. Unknown usage and estimated versus billed costs retain existing behavior. All previous selections and the official source digest are unchanged. See [plan](plans/244-usage-schema.md) and [contract](../contracts/openrouter-schema-drift.md).


## Compatible nonstream usage availability

Normalized nonstream /api/v1 completions omit incomplete usage while keeping internal missing/partial/invalid reporting, allowing official OpenRouter SDK 1.4.18 to deserialize successful responses. Complete safe counters, including zero, remain. Actual socket tests cover direct OpenAI/delegated OpenRouter and sparse native Anthropic/Gemini normalization, shared denials and accounting failures. Detailed billing/token-category projection, incomplete stream usage, legacy SDK sparse usage and full conformance remain open. See [plan](plans/246-compatible-usage.md) and [contract](../contracts/compatible-completion-usage.md).


## Nonstream service tier metadata

Optional nonstream service_tier string/null is preserved by direct OpenAI and delegated OpenRouter across both bases and pinned official OpenRouter/OpenAI SDKs. Malformed values fail safely; IAM/limits/accounting remain shared and operational metadata excludes tier values. This is response metadata only; native mappings, request controls, streamed tiers and complete conformance remain open. See [plan](plans/248-service-tier.md) and [contract](../contracts/service-tier-responses.md).


## Delegated stream service tier metadata

Delegated text streams preserve optional service_tier string/null in chunks and actual final usage metadata through both bases and pinned official SDK sockets. Values do not influence policy/limits/accounting and remain outside operational metadata/errors. Malformed values retain safe first/later failures; absent final usage/tier is never inferred from prior chunks. Direct/tool/native streams, tier request controls and full conformance remain open. See [plan](plans/250-stream-service-tier.md) and [contract](../contracts/stream-service-tiers.md).


## Delegated min-p sampling subset

Nullable min_p finite 0..1 now passes both chat bases and pinned official SDKs to delegated OpenRouter nonstream/text-stream requests with exact values and approved provider scope. Direct OpenAI/Anthropic/Gemini supplied controls reject before credentials; null/omission preserves defaults. IAM/limits/audit/usage and safe failures remain shared. Individual model capability, native mappings, min_p structural source selection and complete compatibility remain open. See [plan](plans/252-min-p.md) and [contract](../contracts/client-min-p.md).

## Min-p request source drift

Version 11 selects min_p as the nineteenth request field. This bounded source guard does not certify native-provider support, runtime instance validation or full compatibility. Release gate #116 remains partial. See [plan](plans/254-min-p-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated top-a sampling subset

Nullable top_a finite 0..1 now passes both chat bases and pinned official SDKs to delegated OpenRouter nonstream/text-stream requests with exact values and approved provider scope. Direct OpenAI/Anthropic/Gemini supplied controls reject before credentials; null/omission preserves defaults. IAM/limits/audit/usage and safe failures remain shared. Individual model capability, native mappings, top_a structural source selection and complete compatibility remain open. See [plan](plans/256-top-a.md) and [contract](../contracts/client-top-a.md).

## Top-a request source drift

Version 12 selects top_a as the twentieth request field. This bounded source guard does not certify native-provider support, runtime instance validation or full compatibility. Release gate #116 remains partial. See [plan](plans/258-top-a-schema.md) and [contract](../contracts/openrouter-schema-drift.md).
