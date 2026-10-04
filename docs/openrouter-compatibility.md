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
- Current text-chat request: model plus string-content messages (exact text-part arrays on supported roles also normalize to strings), optional stream false (or true for delegated text/function streams and managed OpenAI text/refusal/function or Anthropic text/function or Gemini text/function streams when the corresponding trusted invoker is installed), optional n=1 and positive-integer max_tokens or max_completion_tokens and optional stop (string or up to four strings), optional top_p (finite number in 0..1), and optional temperature (finite number in 0..2; direct Anthropic 0..1). Discovery uses GET models; chat uses POST chat/completions relative to the base.

Tools with a hardcoded openrouter.ai host need a configurable endpoint or an integration change. Path aliases alone do not make tools needing streaming, function calls or advanced parameters work.

## Compatibility matrix

| Area | Current state | Remaining acceptance gate |
| --- | --- | --- |
| Base paths and Bearer token | /api/v1 chat/models aliases; shared proxy authorization; pinned OpenAI SDK smoke tests | Broader direct streaming and named-client workflows; OpenCode 1.18.5 explicit custom-provider registration/text is verified on delegated and managed OpenAI/Anthropic/Gemini fixture routes |
| Model discovery | IAM-filtered aliases; optional administrator-published SDK-required discovery metadata and bounded offset/limit paging on /api/v1 | Metadata provisioning/refresh, broader filter queries, broader optional fields and complete discovery workflows |
| Non-streaming text chat | One normalized choice with portable output/sampling controls, provider-bounded verbosity/effort, and delegated min_p/top_a/repetition_penalty | Remaining request/response schema, sampling and capability metadata |
| Streaming | Managed Gemini HTTP text/function streams with exact initial version identity, complete objects with bounded same-part signatures through raw HTTP/OpenAI SDK and explicitly configured OpenCode, dense call indices, clean framed EOF, final reported totals and actual SDK/persisted direct/dual checks on both bases; managed Anthropic HTTP text/function streams with bounded JSON arguments, generated persisted direct/dual wiring, cumulative aggregate usage and actual OpenAI/OpenRouter SDK checks on both bases; managed OpenAI HTTP text/refusal/indexed function streams with per-attempt usage/audit, generated persisted direct/dual wiring and actual SDK checks on both bases; delegated HTTP text/refusal/scalar/detail reasoning and indexed function streams with bounded validation, awaited delivery, cancellation, final usage metadata and interruption audit; both installed SDKs exercise function workflows on both bases; OpenCode 1.18.5 reads a fixture through a streamed function and completes correlated results on delegated and managed OpenAI/Anthropic/Gemini fixture routes | Gemini partial-argument streams and Anthropic/Gemini thinking/server-tool streams, native custom/multimodal and other tool variants, unselected schema targets, additional stream option fields and full named external-client conformance |
| Tool calling | Validated function-tool requests and complete text-only result histories; delegated OpenRouter nonstream/stream assistant calls and direct OpenAI nonstream/stream calls and bounded managed Anthropic nonstream/stream declarations/choices/calls/correlated results; bounded managed Gemini nonstream/stream declarations/choices/calls/results with thinking disabled, plus official nonstream/stream same-part tool-call signature replay through raw HTTP/OpenAI SDK and explicitly configured OpenCode; SDK socket tests cover two-function continuations and fresh IAM | Server/custom tools, rich content, other native mappings and broader named external-tool workflows and application configurations |
| Rich inputs and outputs | Text-only parts normalize to strings; validated refusal, scalar reasoning (including bounded reasoning-only stop/length) and summary/text/encrypted detail responses; service tier/fingerprint/native finish metadata on supported routes | Multimodal/cached content, native thinking/block semantics, broader structured reasoning request controls and native detail history, local JSON-schema output enforcement and server-tool details |
| Client routing controls | Rejected today | Client preferences narrow approved model/provider scope; no arbitrary destinations or authority widening |
| Errors | /api/v1 numeric status codes, fixed messages, safe local reason/typed metadata, request ID and compatible midstream error chunks; legacy /v1 symbolic codes | Precise upstream error_type propagation, retry hints and full provider streaming errors |
| Other model-use endpoints | Not implemented | Inventory completions, responses, embeddings and generation lookup against external-tool requirements and authorization |
| Usage reporting | Aggregate counters with missing/partial/invalid classifications; bounded nonstream categories on direct OpenAI/delegated OpenRouter and final delegated, managed OpenAI and bounded Anthropic/Gemini aggregate stream usage and Gemini informational cached/reasoning categories and Anthropic cache-aware aggregates/read-write categories on nonstream and text/function streams | Other native categories, category ledger reporting, provider-billed cost/BYOK/server-tool projection and complete usage certification |
| Operational OpenGranter APIs | Usage/audit extensions on /v1 | Keep their authorization and contracts explicit during compatibility expansion |

## Current conformance checkpoint (2026-10-05)

The version-19 pin tracks twenty-three selected request fields, fourteen selected request/history definitions, five stream definitions, three successful-response definitions, three usage/billing definitions and eight reasoning definitions, plus the selected message-name and tool-history maps. The message-role union and complete system/developer/user definitions are now selected; whole assistant/tool schemas remain tracked through their existing maps. Structural drift coverage does not validate every runtime instance or certify every referenced capability. In particular, server-tool schema coverage does not enable server tools, and the documented verbosity/native-finish extensions remain outside the published chat schema or pinned OpenRouter SDK surface.

Actual OpenRouter 1.4.18 and OpenAI 7.23.0 SDK socket tests cover the supported subsets with controlled upstream fixtures. They do not certify named external applications or live model capability. Compatible /api/v1 completions project unavailable fingerprints to null and omit incomplete usage, while the ledger preserves known counters and missing/partial/invalid status. Legacy omissions/sparse usage and null stream fingerprints retain their measured SDK gaps. The pinned OpenRouter chat SDK strips native_finish_reason; raw HTTP and the OpenAI SDK preserve that extension.

Installed OpenCode 1.18.5 separately passes fifty isolated local-gateway probes: delegated and managed OpenAI/Anthropic/Gemini registration, text/function-result workflows, initial and follow-up Deny, process-disconnect accounting and explicit signed-Google namespace success on both bases. Default signed-Google loss is an intentionally bounded failure measurement because its outer 5xx retries have no cap. The transport is mocked at fixed approved hosts. This does not certify automatic gateway model discovery, general interactive cancellation/retry behavior, live providers, other client versions or complete external-tool compatibility. See [reproduction guide](opencode-conformance.md).

Managed OpenAI text/refusal streams now reach both public chat bases through the optional trusted direct stream port, generated from stored native registrations in direct/dual PostgreSQL servers. Captured fixed-host transport and exact configured upstream IDs pass through the existing managed IAM/limits/Jev/order coordinator, per-attempt usage/audit and bounded HTTP delivery. Final usage/DONE require successful handoffs; no fallback follows emitted output or cancellation. Both installed SDKs pass socket probes on both bases, including native-body abort accounting. Unsupported selected native registrations fail before provider-key lookup without changing selection. Managed OpenAI function streams now use the same controls and complete two-call/result lifecycles with both SDKs on both bases; completed calls stay outside routing/accounting metadata. Trusted function availability is checked per route kind. Generated PostgreSQL direct/dual adapters replace runtime overrides. Custom/server tools, native thinking/rich streaming, model snapshot equivalence and broader named-application conformance remain open; the isolated OpenCode 1.18.5 managed text/function/Deny/process-disconnect subset is now verified. See [function plan](plans/388-public-managed-functions.md) and [function contract](../contracts/public-managed-functions.md). See [plan](plans/380-managed-gateway-stream.md) and [contract](../contracts/managed-gateway-stream.md).

All supported paths keep authentication, complete destination IAM with explicit Deny precedence, limits, required audit and usage persistence. Sensitive reasoning/opaque details, prompts, responses and credentials stay out of operational records/errors. Complete final usage and DONE require successful persistence; final tier/fingerprint/native metadata comes only from the actual usage event, and scalar/detail reasoning is never replayed there. Physical socket acknowledgment, durable failed-audit recovery, remaining native/rich streaming and other tool variants, transitive fragment-schema drift, metadata refresh, structured reasoning request controls, native history mappings and named external-client workflows remain release gates under #116.

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

The delegated OpenRouter request adapter captures the IAM-approved upstream model and final-provider slug set before resolving a credential. Its HTTP body and response-scope check use that immutable attempt, even if a caller-owned object changes during the await. The delegated streaming invoker reuses this boundary. See [plan](plans/200-openrouter-attempt-snapshot.md) and [contract](../contracts/openrouter-attempt-snapshot.md).

The internal delegated text-stream invoker now sends one `stream:true` request to the same fixed endpoint with the same captured model/provider scope and text/sampling request preparation as the non-streaming adapter. It rejects tool controls before credential lookup, awaits validated SSE deltas, and returns final usage only after a complete sequence. The delegated HTTP composition now wires it to both chat paths through shared IAM, limits, accounting and audit; direct/tool streams remain unsupported. See [plan](plans/202-openrouter-stream-invoker.md) and [contract](../contracts/openrouter-stream-invoker.md).

The internal client SSE encoder projects validated text deltas, complete usage and `[DONE]` into OpenRouter-shaped frames using the authorized client model alias. It escapes text within a single data frame and suppresses incomplete usage instead of fabricating counters. This suppression is an explicit gap against OpenRouter's documented final usage frame. The encoder does not validate event order, send HTTP bytes, record usage/audit or enable client `stream:true`. See [plan](plans/204-openrouter-client-sse.md) and [contract](../contracts/openrouter-client-sse.md).

The delegated text-stream composition now runs validated deltas through the existing IAM, verified provider mapping, limit, usage and audit coordinator. It returns usage and `[DONE]` frames only after the success handoff; partial output on later failures has no terminal success frames. The [HTTP composition](../contracts/delegated-http-stream.md) implements bounded delivery, client cancellation and post-accounting interruption audit. Direct-provider streams, physical socket acknowledgment and durable failed-audit recovery remain open. See [plan](plans/206-delegated-text-stream.md) and [contract](../contracts/delegated-text-stream.md).

## Sources checked 2026-09-28

OpenRouter documents /api/v1 with Bearer authentication and configurable SDK base URLs: [authentication](https://openrouter.ai/docs/api_reference/authentication). Its unified chat schema includes additional parameters, tools, richer messages and response fields: [API overview](https://openrouter.ai/docs/api_reference/overview). Streaming uses SSE and has distinct pre-stream and mid-stream errors: [streaming](https://openrouter.ai/docs/api_reference/streaming). The [official OpenAPI specification](https://openrouter.ai/openapi.json) supplies the selected structural drift pin; full instance and client conformance remain open.

## Output-token limit conformance

The current adapters support max_tokens through both client paths, including direct registration caps, omission defaults, malformed-value rejection and captured values during asynchronous credential resolution. See [contract](../contracts/client-output-limits.md) and [plan](plans/118-client-output-limits.md). Full compatibility remains pending.

## Error display conformance

Fixed error.message is available for all gateway failures and the Node bridge fallback. Legacy /v1 symbolic codes remain unchanged; /api/v1 uses numeric HTTP status, metadata.opengranter_code and allowlisted metadata.error_type. Pre-frame JSON and sanitized compatible midstream error chunks are implemented. Precise upstream error_type propagation, retry hints and broader provider stream mappings remain open. See [contract](../contracts/safe-client-errors.md).

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

Fixed metadata.error_type is available alongside numeric codes and local reasons on compatible paths. Known local causes map to documented vocabulary; dependency failures use server and collapsed provider failures remain unmapped. Precise upstream cause propagation, retry hints and broader provider stream-error mappings remain open. See [plan](plans/132-typed-client-errors.md) and [contract](../contracts/openrouter-error-schema.md).

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

OpenAI and delegated OpenRouter preserve optional string/null refusal and content_filter, including null content only when refusal/filter signals justify it. SDK and both-prefix coverage retains security/accounting controls and safe malformed-response failures. Valid refusals are successful deliveries; metadata audit does not record their text. Bounded native Anthropic refusal/Gemini SAFETY mappings, non-streaming function outcomes and delegated refusal streams are implemented separately. Rich native outcomes, direct/tool streams and complete response-schema coverage remain open. See [plan](plans/146-refusal-outcomes.md) and [contract](../contracts/refusal-outcomes.md).

## Direct Anthropic refusal subset

Explicit non-streaming Anthropic refusal with valid empty/text-only content maps to null-content/content_filter and refusal=null. Partial text and stop_details are not forwarded. Both prefixes, actual SDK, normal text parity, configured backup, usage/missing/invalid accounting and security gates are covered. Rich native blocks, provider billing-category projections, automatic refusal fallback and stream/tool workflows remain incomplete. See [plan](plans/152-anthropic-refusals.md) and [contract](../contracts/anthropic-refusals.md).

## Direct Gemini SAFETY subset

Empty direct Gemini SAFETY prompt/candidate blocks map to null-content/content_filter with success-delivery accounting and no fallback. Both prefixes, actual SDK, usage/missing/invalid accounting, malformed-block and security gate cases are covered. Bounded Anthropic explicit refusals are implemented separately; other native reasons, populated block shapes and native tool/stream workflows remain open. See [plan](plans/150-gemini-safety.md) and [contract](../contracts/gemini-safety.md).

## Frequency and presence penalty subset

Optional nullable penalties in [-2,2] map to OpenAI/OpenRouter native names and Gemini camelCase fields with exact values and omission defaults. Direct Anthropic non-null values fail before credentials/transport. Both paths, SDK, scalar capture, Google standalone settings and security/accounting cases are covered. Per-model support, capability-aware selection and broader sampling/tool/stream conformance remain pending. See [plan](plans/156-penalty-controls.md) and [contract](../contracts/client-penalties.md).
## Portable response-format subset

Exact text/json_object controls are captured and mapped across both paths. OpenAI/OpenRouter forward the format; Gemini maps MIME; Anthropic text uses its default and JSON fails before secret/transport. SDK, omission/capture, combined controls and security/accounting cases are covered. Per-model support, local output validation/repair, native schema mappings, native Anthropic JSON, capability selection and full tool/stream conformance remain pending. See [plan](plans/154-response-formats.md) and [contract](../contracts/client-response-formats.md).

## Client top-k subset

Nullable nonnegative safe-integer top_k preserves supplied values/defaults on both bases and SDK serialization. OpenRouter/Anthropic retain the external field; Gemini uses int32-bounded generationConfig.topK and direct OpenAI rejects supplied controls before secrets. Capture, settings-only configuration, malformed inputs and shared security/accounting are covered. Newer Anthropic and model-specific Gemini restrictions remain upstream/model dependent; capability routing and full tool/stream/client conformance remain incomplete. top_k is included in the reviewed thirteen-field source projection; native schema/capability validation remains open. See [plan](plans/162-top-k.md) and [contract](../contracts/client-top-k.md).

## Client seed subset

Nullable safe-integer seed controls preserve omission defaults and values across both client bases and SDK requests. OpenAI/OpenRouter forward seed; Gemini generationConfig.seed is bounded by native signed int32, while Anthropic supplied seeds reject before credentials. Native capture, settings-only configuration and security/accounting paths are covered. Model-dependent support, deterministic output, native fingerprint synthesis and full client/tool/stream workflows remain open. Seed and top_k are now included in the reviewed source-drift allowlist; this does not guarantee runtime model support. See [plan](plans/160-client-seed.md) and [contract](../contracts/client-seed.md).

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

Compatible nonstream unknown fingerprints now deserialize as null. Actual SDK validation still rejects legacy omitted fingerprints, basic unconfigured/legacy discovery catalogs and legacy standalone midstream errors. Compatible /api/v1 midstream errors now deserialize as yielded error chunks with finishReason:error followed by EOF; callers must inspect their error fields. The official stream schema also rejects the gateway's local null fingerprint allowance. Tests recording gaps are an inventory and must evolve with implementing features, not certification of full compatibility. Named external-tool workflows, metadata provisioning/refresh, richer/direct/tool streams and complete conformance remain open. See [plan](plans/224-official-sdk.md) and [contract](../contracts/official-openrouter-sdk.md).

## Compatible midstream error subset

Started /api/v1 delegated failures now use delivered chunk identity and finish_reason:error alongside existing fixed numeric errors. Pre-frame JSON and legacy /v1 remain unchanged. EOF/no DONE, required accounting/audit and cancellation controls stay shared. Raw upstream error propagation, precise retry types and complete client conformance remain gaps. See [plan](plans/222-midstream-error-chunks.md) and [contract](../contracts/midstream-error-chunks.md).

## Delegated streaming refusal subset

Both chat bases support validated optional string/null refusal deltas and content_filter termination without fallback/replay. JSON framing preserves exact response text, with safe malformed-value failures and shared security/accounting controls. Usage-only events cannot discard substantive refusal text; missing usage remains unknown. Direct/tool/multimodal streams, structured request/history reasoning and full external-client conformance remain open; delegated scalar/detail reasoning response streams are implemented separately. See [plan](plans/218-stream-refusals.md) and [contract](../contracts/stream-refusals.md).

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

Both chat bases accept optional nullable reasoning_effort with max/xhigh/high/medium/low/minimal/none for delegated nonstream and text streaming. Capture and forward exact supplied values without defaults; approved model/provider scope, IAM, limits, output controls and required accounting/audit stay unchanged. Invalid values reject before routing, while direct Anthropic and unsupported Gemini values reject before credentials; direct OpenAI and the bounded Gemini subset map native fields. Actual SDK mapping and public-boundary cases are covered by [contract](../contracts/client-reasoning-effort.md) and [plan](plans/274-reasoning-effort.md). Fresh official OpenAPI and pinned SDK include max, unlike the shorter parameter overview. The current schema pin tracks reasoning_effort. Structured reasoning, other native mappings and richer request/history/response remain explicit gaps; request forwarding alone does not certify full reasoning compatibility. The direct OpenAI extension depends on PR #275; release gate #116 remains open.

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

Both bases preserve optional string/null reasoning through bounded delegated streams and actual SDK 1.4.18 validation. Decoder/encoder checks, safe framing/failure, existing IAM/limits/usage/audit and cancellation controls remain shared; reasoning never enters operational metadata or completed summaries. Final usage cannot discard substantive reasoning or replay earlier text. Non-streaming scalar/detail responses and delegated streamed details are implemented in their separate contracts below. Structured request/history reasoning, native Anthropic/Gemini thinking responses and full external-client conformance remain open. The existing ChatStreamDelta source pin already selects this field. See [plan](plans/238-stream-reasoning.md) and [contract](../contracts/stream-reasoning.md).

## Non-streaming reasoning text subset

Already-valid direct OpenAI/delegated OpenRouter assistant responses preserve optional reasoning string/null through both bases and actual SDK 1.4.18 sockets. Current text/refusal/tool validation, IAM/limits, required accounting/audit and safe failed-attempt semantics stay shared; reasoning never enters operational metadata and missing usage stays unknown. Structured request controls and detailed history, native Anthropic/Gemini thinking mappings and full external-client conformance remain open. Summary/text/encrypted detail responses are implemented separately below. See [plan](plans/240-nonstream-reasoning.md) and [contract](../contracts/nonstream-reasoning.md).


## Nonstream response source drift

Version 9 tracks the official successful nonstream response reference plus ChatResult, ChatChoice and ChatAssistantMessage structures. Required fields, nullability, references and structural constraints cause drift; annotations remain ignored. Previously selected structures and source digest are unchanged. This is structural source tracking, not runtime certification or recursive usage/rich-content/reasoning-detail conformance. Release gate #116 remains partial. See [plan](plans/242-response-schema.md) and [contract](../contracts/openrouter-schema-drift.md).


## Chat usage source drift

Version 10 selects ChatUsage, CostDetails and ServerToolUseDetails, including inline token details, as bounded structural source coverage shared by chat and stream responses. Source selection does not imply runtime support for every field, server tools or complete usage/SDK conformance. Unknown usage and estimated versus billed costs retain existing behavior. All previous selections and the official source digest are unchanged. See [plan](plans/244-usage-schema.md) and [contract](../contracts/openrouter-schema-drift.md).


## Compatible nonstream usage availability

Normalized nonstream /api/v1 completions omit incomplete usage while keeping internal missing/partial/invalid reporting, allowing official OpenRouter SDK 1.4.18 to deserialize successful responses. Complete safe counters, including zero, remain. Actual socket tests cover direct OpenAI/delegated OpenRouter and sparse native Anthropic/Gemini normalization, shared denials and accounting failures. Detailed billing/token-category projection, incomplete stream usage, legacy SDK sparse usage and full conformance remain open. See [plan](plans/246-compatible-usage.md) and [contract](../contracts/compatible-completion-usage.md).


## Nonstream service tier metadata

Optional nonstream service_tier string/null is preserved by direct OpenAI and delegated OpenRouter across both bases and pinned official OpenRouter/OpenAI SDKs. Malformed values fail safely; IAM/limits/accounting remain shared and operational metadata excludes tier values. This is response metadata only; native tier mappings, request controls and complete conformance remain open; delegated streamed tier metadata is implemented separately below. See [plan](plans/248-service-tier.md) and [contract](../contracts/service-tier-responses.md).


## Delegated stream service tier metadata

Delegated text streams preserve optional service_tier string/null in chunks and actual final usage metadata through both bases and pinned official SDK sockets. Values do not influence policy/limits/accounting and remain outside operational metadata/errors. Malformed values retain safe first/later failures; absent final usage/tier is never inferred from prior chunks. Direct/tool/native streams, tier request controls and full conformance remain open. See [plan](plans/250-stream-service-tier.md) and [contract](../contracts/stream-service-tiers.md).


## Delegated min-p sampling subset

Nullable min_p finite 0..1 now passes both chat bases and pinned official SDKs to delegated OpenRouter nonstream/text-stream requests with exact values and approved provider scope. Direct OpenAI/Anthropic/Gemini supplied controls reject before credentials; null/omission preserves defaults. IAM/limits/audit/usage and safe failures remain shared. The current schema pin tracks min_p. Individual model capability, native mappings and complete compatibility remain open. See [plan](plans/252-min-p.md) and [contract](../contracts/client-min-p.md).

## Min-p request source drift

Version 11 selects min_p as the nineteenth request field. This bounded source guard does not certify native-provider support, runtime instance validation or full compatibility. Release gate #116 remains partial. See [plan](plans/254-min-p-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated top-a sampling subset

Nullable top_a finite 0..1 now passes both chat bases and pinned official SDKs to delegated OpenRouter nonstream/text-stream requests with exact values and approved provider scope. Direct OpenAI/Anthropic/Gemini supplied controls reject before credentials; null/omission preserves defaults. IAM/limits/audit/usage and safe failures remain shared. The current schema pin tracks top_a. Individual model capability, native mappings and complete compatibility remain open. See [plan](plans/256-top-a.md) and [contract](../contracts/client-top-a.md).

## Top-a request source drift

Version 12 selects top_a as the twentieth request field. This bounded source guard does not certify native-provider support, runtime instance validation or full compatibility. Release gate #116 remains partial. See [plan](plans/258-top-a-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated repetition-penalty sampling subset

Nullable repetition_penalty finite 0..2 now passes both chat bases and pinned official SDKs to delegated OpenRouter nonstream/text-stream requests with exact values and approved provider scope. Direct OpenAI/Anthropic/Gemini supplied controls reject before credentials; null/omission preserves defaults. IAM/limits/audit/usage and safe failures remain shared. The current schema pin tracks repetition_penalty. Individual model capability, native mappings and complete compatibility remain open. See [plan](plans/260-repetition-penalty.md) and [contract](../contracts/client-repetition-penalty.md).

## Repetition penalty request source drift

Version 13 selects repetition_penalty as the twenty-first request field. This bounded source guard does not certify runtime instance validation, native model support or full compatibility. Release gate #116 remains partial. See [plan](plans/262-repetition-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Nonstream native finish reasons

Documented nonstream native_finish_reason now survives both HTTP bases and OpenAI SDK raw JSON. Current official ChatChoice and pinned OpenRouter chat SDK omit the field, and that SDK strips it; source/SDK coverage is not claimed. Delegated streaming preserves this extension under its separate contract below. Native synthesis and full response/client conformance remain open. See [plan](plans/264-native-finish-reason.md) and [contract](../contracts/native-finish-reason.md).

## Reasoning-effort source drift subset

Version 14 selects reasoning_effort as the twenty-second request field. This bounded source guard does not certify runtime instance validation, native support or complete compatibility; release gate #116 remains open. See [plan](plans/276-reasoning-effort-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Referenced reasoning-detail source drift

Version 15 adds exactly eight reasoningDefinitions for nonstream/stream arrays, their shared union, summary/encrypted/text/server-tool-call variants and ReasoningFormat. Track structure, references, discriminator mappings, required lists, types/nullability, constraints, extensions and literal defaults while ignoring annotations. Missing/malformed source definitions and rehashed invalid exact maps fail safely; versions 1..14 reject. All version-14 selections and source provenance remain unchanged. Existing whole assistant/stream delta selections retain parent field/reference/required tracking. This does not enable runtime reasoning details, server tools, signatures/history, or complete reasoning/client compatibility. IAM, credentials, usage and audit behavior are unchanged. See [plan](plans/282-reasoning-details-schema.md).

## Nonstream reasoning-detail subset

Direct OpenAI and delegated OpenRouter preserve optional reasoning_details arrays, including empty arrays, with validated summary/text/encrypted items. Preserve opaque payloads, optional nullable string metadata and safe integer indices without parsing/verifying them. Unknown fields, malformed data and unsupported server-tool-call items fail safely with possibly-billed failed accounting. Existing finish/content/refusal/function rules, IAM/Deny/limits, required audit/ledger and missing usage remain unchanged. Operational records/errors exclude details and credentials. This response subset does not enable server tools or native thinking; delegated history details are covered by the separate history contract below. Delegated streamed details are implemented under their separate contract below. See [plan](plans/284-nonstream-reasoning-details.md) and [contract](../contracts/nonstream-reasoning-details.md).

## Delegated stream reasoning details

Both chat bases preserve validated reasoning_details arrays on delegated text-stream deltas, including empty arrays and omitted fields, in frame and item order. The summary/text/encrypted subset uses immutable snapshots and preserves opaque nullable metadata without interpretation or reconstruction. Malformed items, unknown fields and server-tool-call items fail safely with possibly-billed accounting. Any supplied detail field on a usage-only event rejects, including empty arrays and incomplete token counts, as an explicit local content-free-frame restriction. IAM/Deny/limits, required audit/ledger, cancellation and unknown usage remain shared; details stay outside operational records and errors. Direct/tool streams, structured reasoning request controls, native thinking and full external-client conformance remain open; delegated history details are covered separately below. See [plan](plans/286-stream-reasoning-details.md) and [contract](../contracts/stream-reasoning-details.md).

## Independent SSE content validation

The client encoder captures delta content/refusal once and rejects injected substantive or malformed fields on usage-only events before incomplete-count suppression. Absent/null/empty usage fields remain permitted without replay; exact delta strings/null/omission and JSON frame escaping remain intact. Authentication, IAM/Deny, limits, required audit/usage and operational content exclusion remain unchanged. This bounded validation does not certify all fields or complete external-client conformance. See [plan](plans/288-sse-content-validation.md) and [contract](../contracts/openrouter-client-sse.md).

## Nonstream token usage details

Direct OpenAI and delegated OpenRouter preserve recognized prompt/completion detail categories with exact omission/null/empty/zero semantics on both chat bases. Immutable allowlisted projection omits malformed groups independently and preserves aggregate accounting; details never fabricate totals or add ledger charges. Compatible incomplete usage remains omitted. Authentication/IAM/Deny/limits and required audit/usage gates stay unchanged. Native category mappings, detailed ledger/cost projection and complete certification remain open; delegated final stream categories follow their separate contract below. See [plan](plans/290-nonstream-token-details.md) and [contract](../contracts/nonstream-token-details.md).

## Final stream token usage details

Delegated streaming preserves the bounded prompt/completion categories from actual final usage events on both bases, with immutable allowlisted snapshots and independent malformed-group omission. Snapshots never derive missing totals or replay earlier content/metadata; categories do not change aggregate accounting. Complete usage and DONE remain gated by required persistence. IAM/Deny, limits, cancellation/backpressure and interruption audit remain unchanged. Native/direct/tool streams, category ledger/cost reporting and complete certification remain open. See [plan](plans/292-stream-token-details.md) and [contract](../contracts/stream-token-details.md).

## Bounded JSON-schema formats

Direct OpenAI/delegated OpenRouter accept bounded json_schema requests, including existing delegated streams, through both bases and actual OpenAI/OpenRouter SDK sockets. Immutable JSON capture rejects malformed/resource-excessive/accessor inputs before dispatch; unsupported native Anthropic/Gemini reject before credentials. Required authentication/IAM/limits/audit/usage and safe errors remain shared. The gateway does not dereference schema URLs, validate or repair output, infer model capability or alter provider scope. Other referenced format definition drift, native schema mappings, managed streams and full external-client conformance remain open. See [plan](plans/296-json-schema-formats.md) and [contract](../contracts/client-response-formats.md).

## JSON-schema format source drift

Version 16 selects the JSON-schema wrapper/config definitions in addition to every prior selection. Inner type/reference/name/schema/description/strict/required/default changes cause drift with unchanged parent references; annotations stay ignored and invalid sources/rehashed maps/older pins reject. The explicit source refresh preserves prior structures and source digest. No runtime, IAM, secret, usage or audit behavior changes, and complete instance/client certification remains open. See [plan](plans/298-json-schema-drift.md) and [contract](../contracts/openrouter-schema-drift.md).

## Optional schema configuration

Named json_schema configurations preserve schema omission exactly through both bases, direct OpenAI/delegated OpenRouter and actual SDK sockets, including existing delegated streams. Supplied object/empty-object validation and bounded immutable snapshots remain intact; native unsupported modes, IAM/limits and required persistence retain their controls. No schema/default or output-conformance guarantee is fabricated. Model capabilities, native mappings, local enforcement and complete external-client compatibility remain open. See [plan](plans/300-optional-config-schema.md) and [contract](../contracts/client-response-formats.md).

## Detail-only nonstream reasoning

Direct OpenAI/delegated OpenRouter support missing/null content on stop/length when the validated detail snapshot contains nonempty summary/text/encrypted data. Valid empty and metadata-only details follow the optional-content stop/length contracts below. Exact details and existing IAM/limits/required persistence/unknown usage controls remain shared through both bases and actual SDK sockets, without decrypting or verifying opaque data. Native thinking/history, direct/tool streams and complete reasoning/external-client conformance remain open. See [plan](plans/302-detail-only-reasoning.md) and [contract](../contracts/nonstream-reasoning-details.md).

## Scalar assistant reasoning history

Delegated OpenRouter preserves optional scalar reasoning on assistant ordinary/complete function histories through both bases and actual SDK sockets, including existing ordinary delegated text streams. Nonempty reasoning permits ordinary missing/null content; malformed/non-assistant/incomplete tool histories reject. Direct OpenAI/Anthropic/Gemini reject supplied reasoning before secrets. Immutable snapshots retain IAM/limits/required persistence/accounting and exclude history from operational records. Native mappings, structured request controls and complete external-client certification remain open; delegated detail history is implemented in the following bounded subset. See [plan](plans/304-assistant-reasoning-history.md) and [contract](../contracts/client-reasoning-history.md).

## Delegated assistant reasoning details history

Delegated OpenRouter accepts assistant reasoning_details history with validated summary/text/encrypted arrays on both chat bases, including existing ordinary text streams and nonstream complete function groups. Preserve omission, empty arrays, opaque payloads/signatures, nullable metadata and item order in immutable snapshots before asynchronous routing. Ordinary null/missing assistant content is accepted independently of scalar or detailed payloads under the delegated no-text history contract. Malformed/non-assistant fields and incomplete tool results reject before routing; all direct providers reject supplied details before credentials. Authentication, complete destination IAM/Deny, limits, required persistence and safe failure accounting remain shared; history never enters operational records/errors. No decryption, authenticity, token inference, server tools, tool streams or native mapping is enabled. Actual SDK sockets replay returned details through both bases; full #116 certification stays open. See [plan](plans/306-assistant-reasoning-details-history.md) and [contract](../contracts/client-reasoning-details-history.md).

## Referenced message history source drift

Version 17 adds exactly ChatMessages, ChatSystemMessage, ChatDeveloperMessage and ChatUserMessage to the existing definitions map (thirteen total). Role discriminator/union/reference, full role/content/required shapes, configuration references, structural bounds/extensions and literal defaults cause drift with unchanged parent references. Editorial annotations and unselected rich/configuration definitions stay ignored. Missing/malformed source containers, invalid rehashed exact maps and versions 1..16 reject. Every version-16 selection remains unchanged. The explicit 2026-10-04 refresh updates source provenance after reviewing unrelated Models API v2, unselected nullability, audio/provider and parameter/SDK-name changes. Runtime/provider/IAM/secrets/accounting behavior is unchanged; selected references do not enable rich/configuration capabilities or complete instance/client certification. See [plan](plans/308-message-history-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated reasoning summary request subset

Both chat bases accept an optional reasoning object with optional summary auto/concise/detailed/null for delegated OpenRouter nonstream and existing ordinary text streams. Preserve omission, empty object and null summary without defaults. Immutable single captures precede routing/credentials; malformed/unknown keys and values reject early. Top-level reasoning_effort and nested effort follow the bounded alias rules below; legacy inclusion, budget, exclusion and activation follow their documented subsets below. All direct providers reject supplied configurations, including {}, before secrets. Shared authentication, full destination IAM/Deny, limits, required audit/usage, safe possible-billing outcomes and operational privacy remain intact; stream final success still requires persistence. Actual SDK sockets cover both bases/modes and effort coexistence. Forwarding does not guarantee summaries, authenticate history, infer costs or enable native/tool streams. Pin v18 now selects the reasoning request field and summary enum; broader controls and complete #116 certification remain open. See [plan](plans/310-reasoning-summary.md) and [contract](../contracts/client-reasoning-summary.md).

## Reasoning summary request source drift

Version 18 adds exactly the whole ChatRequest.reasoning inline field and ChatReasoningSummaryVerbosityEnum (23 fields and 14 main definitions). Summary reference/type/enum/nullability/default/constraint/extension and inline reasoning required/effort changes cause drift with unchanged parents. Annotations stay ignored while literal annotation-named data remains structural. Missing/malformed source containers, rehashed invalid exact maps and versions 1..17 reject. The explicit source refresh preserves every prior selection and source digest. This structural selection itself does not enable nested effort or alter runtime/provider/IAM/secret/accounting behavior; runtime effort follows the separate bounded contract below. Full JSON-instance, native and external-client certification remain open. See [plan](plans/312-reasoning-summary-schema.md) and [contract](../contracts/openrouter-schema-drift.md).

## Delegated nested reasoning effort subset

Delegated OpenRouter now accepts optional reasoning.effort max/xhigh/high/medium/low/minimal/none/null beside optional summary on both chat bases, nonstream and existing ordinary text streams. Preserve omission/empty/null and exact values in immutable single captures before async routing/credentials. Equal simultaneously forwarded named aliases are preserved; differing strings reject early without precedence. Nested null plus a forwarded shorthand string stays an unsupported local subset pending clarification; existing top-level null omission remains unchanged. Direct structured configurations still reject before secrets. IAM/Deny/limits, complete history validation, required audit/usage, safe failures and operational privacy stay shared. Actual SDK sockets cover supported nested/equal aliases and differing-alias denial. Pin v18 is unchanged; alias prose is outside structural drift. Broader budget controls, broader legacy controls, native mappings and full #116 certification remain open. See [plan](plans/314-nested-reasoning-effort.md) and [contract](../contracts/nested-reasoning-effort.md).

## Delegated reasoning exclusion preference

Both chat bases accept optional reasoning.exclude true/false for delegated nonstream and existing ordinary text streams, alongside supported effort/summary and unchanged alias conflict rules. Immutable single capture preserves omission/exact booleans without defaults before async work; null/own undefined/malformed controls reject early. Native structured configurations stay pre-secret unsupported. This forwards the documented preference without locally filtering returned reasoning/details, inferring free/reduced usage or promising summary precedence. Empty-string length responses remain successful; no-text length responses follow the supported subset below; other null/missing-content outcomes remain bounded. Authentication, complete IAM/Deny, limits, required audit/usage, persistence-gated streams and operational privacy stay shared. Actual OpenAI-compatible SDK sockets preserve the extension on both bases/modes; pinned OpenRouter SDK sockets expose stripping. The current official OpenAPI omits exclude, so unchanged pin v18 does not certify it. Null semantics, broader budget/broader legacy controls, native mappings, tool streams and full #116 certification remain open. See [plan](plans/316-reasoning-exclusion.md) and [contract](../contracts/client-reasoning-exclusion.md).

## Delegated reasoning activation preference

Both chat bases accept optional reasoning.enabled true/false for delegated nonstream and existing ordinary text streams, preserving exact booleans/omission and optional summary/exclusion without default effort injection. Supplied enabled plus any nested effort (including null) or forwarded named shorthand is outside this local subset pending raw-chat interaction clarification; this is not an official conflict rule. Existing top-level null omission and effort-only alias rules remain unchanged. Immutable single captures precede async work; null/own undefined/malformed controls reject early and native structured configurations stay pre-secret unsupported. Forwarding does not guarantee activation, filter returned reasoning or infer reduced/free usage. Authentication, complete IAM/Deny, limits, required audit/usage, stream persistence, operational privacy and safe possible-billing failures remain shared. Actual OpenAI-compatible SDK sockets preserve the extension on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping. Current OpenAPI omits enabled and unchanged v18 cannot certify it. Effort interactions, null/summary precedence, broader budget/broader legacy controls, native mappings, tool streams and full #116 certification remain open. See [plan](plans/318-reasoning-activation.md) and [contract](../contracts/client-reasoning-activation.md).

## Delegated reasoning token budget

Both chat bases accept optional reasoning.max_tokens as positive safe integers for delegated nonstream and existing ordinary text streams. Numeric bounds are an explicit local subset, not official generic constraints. Preserve exact values/omission and optional summary/exclusion without effort/default/clamp injection. A supplied budget with any nested effort, forwarded named shorthand or supplied enabled remains outside the local subset pending conflicting/unspecified source guidance; no precedence is invented. Existing top-level null normalization and effort/activation-only contracts stay intact. Immutable single captures precede async work; invalid/null/zero/negative/fraction/unsafe controls reject early, native structured configurations reject pre-secret, and the outer output maximum remains independent and unchanged. IAM/Deny/limits, required audit/usage, stream persistence, operational privacy, actual/unknown usage and safe possible-billing failures stay shared; budget does not fabricate charges or filter responses. Actual compatible SDK sockets preserve the raw extension on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping. Current OpenAPI omits this child field and unchanged v18 cannot certify it. Provider-specific constraints/exact-token guarantees, mixed controls/null/zero semantics, native mappings, tool streams and full #116 certification remain open. See [plan](plans/320-reasoning-budget.md) and [contract](../contracts/client-reasoning-budget.md).

## Legacy reasoning inclusion aliases

Both chat bases accept optional include_reasoning true/false for delegated nonstream and existing ordinary text streams, normalizing the documented equivalents true to reasoning {} and false to reasoning {exclude:true} while removing the legacy field upstream. Preserve omission and independent named shorthand without defaults. Null/malformed flags and simultaneous supplied reasoning configurations reject before routing/credentials as an explicit local subset restriction; no mixed-field precedence is invented. HTTP and adapter boundaries capture once and freeze before async work; native providers reject supplied flags, including false, pre-secret with safe accessor errors. IAM/Deny/limits, complete history validation, required audit/usage, stream persistence, operational privacy and safe possible-billing failures remain shared; no local response filtering or usage inference. Actual compatible SDK sockets send raw aliases and gateway normalization works on both bases/modes; pinned OpenRouter SDK sockets demonstrate stripping with independent effort preserved. Current OpenAPI omits the flag and unchanged v18 cannot certify it. Mixed configurations/null semantics, native mappings, tool streams and complete #116 certification remain open. See [plan](plans/322-legacy-reasoning-alias.md) and [contract](../contracts/client-legacy-reasoning.md).

## No-text length completions

Direct OpenAI and delegated OpenRouter nonstream preserve null/missing assistant content with finish_reason length on both bases, independently of request flags or reasoning token details. Missing content normalizes to null consistently with existing response shape; preserve length and valid optional fields without fabricating text/usage/costs. Existing role/envelope/model/finish/tool/refusal/reasoning validation remains enforced; malformed values and tool mismatches fail safely. Stop without payload follows the optional-content contract below; unsupported finishes remain rejected. IAM/Deny/limits, required audit/usage, operational privacy and safe failures stay shared; delivered length outcomes record success only after required persistence and missing usage stays unknown. Actual OpenAI/OpenRouter SDK sockets retain canonical null/length on both bases/routes. Response acceptance does not widen history inputs or native/stream thinking. Pin v18 already selects the assistant shape and is unchanged. Broader no-content/native/tool-stream cases and full #116 certification remain open. See [plan](plans/324-no-text-length.md) and [contract](../contracts/no-text-length.md).

## Optional content on stop completions

Direct OpenAI and delegated OpenRouter nonstream stop responses accept null/missing assistant content on both bases independently of substantive reasoning/refusal, request controls or usage categories. Preserve canonical missing-to-null shape, stop and validated optional fields without fabricated text/reasoning/zero usage/costs. Valid empty/metadata-only details may accompany supported stop/length; inherited reasoning/details stay unprojected and no metadata grants authority. Existing malformed field/role/envelope/model/tool/finish checks, IAM/Deny/limits, required usage/audit delivery gates, privacy and safe possible-billing failures remain intact. Delivered stop records success only after persistence and does not guarantee visible text; missing usage stays unknown. Actual OpenAI/OpenRouter SDK sockets retain canonical null/stop on both bases/routes. Current optional nullable assistant schema/SDK supports this; unchanged v18 already selects the shape and no fresh full-source comparison is asserted. History input/native thinking/stream rules are unchanged. Broader optional-content/rich/native/tool-stream/history cases and full #116 certification remain open. See [plan](plans/326-no-text-stop.md) and [contract](../contracts/no-text-stop.md).

## Delegated no-text assistant history

Both chat bases accept delegated OpenRouter null/missing ordinary assistant histories independently of substantive reasoning, including existing ordinary text streams. Missing content normalizes to null; validated empty/metadata-only fields remain preserved without authority. Empty tool-call lists also accept null/missing content nonstream; tool fields remain unsupported in streams and complete pending-result integrity stays enforced. Direct providers reject bare-null ordinary/empty-call histories before secrets; direct OpenAI supplied refusal follows the separate refusal history contract below, and complete nonempty function groups stay supported. Malformed/non-assistant content rejects early. Immutable capture, authentication, full destination IAM/Deny, limits, required usage/audit delivery gates, privacy and possible-billing failures remain shared; missing usage stays unknown. Actual pinned SDK sockets cover both bases/modes. Earlier schema retrieval and SDK support this subset; unchanged v18 and timed-out fresh retrieval do not establish fresh source comparison. Native/rich/tool-stream and full #116 certification remain open. See [plan](plans/328-no-text-history.md) and [contract](../contracts/no-text-history.md).

## Assistant refusal history

Both chat bases preserve optional assistant refusal string/null on delegated OpenRouter and direct OpenAI ordinary and complete nonstream function histories. Omission/null/empty/Unicode remain exact in immutable single captures; missing content normalizes to null. Direct OpenAI permits canonical null with a supplied validated refusal, while bare-null history stays unsupported. Anthropic/Gemini reject all supplied markers pre-secret. Existing delegated ordinary text streams carry refusal history; tool/direct streams stay open; refusal content parts follow the translation contract below. Malformed/non-assistant/own undefined markers, unknown fields and incomplete tool groups reject early. History grants no authority; IAM/Deny/limits, required usage/audit gates, safe possibly-billed failures, unknown usage and operational privacy remain shared. Actual OpenAI/OpenRouter SDK sockets cover both bases, with delegated ordinary streams. Current OpenAI reference/installed SDK and earlier OpenRouter schema support the subset; unchanged v18 does not assert fresh source comparison or full #116 certification. See [plan](plans/330-refusal-history.md) and [contract](../contracts/client-refusal-history.md).

## Assistant refusal content-part translation

Both chat bases translate exactly one assistant refusal content part with string payload into canonical content:null/refusal:string for direct OpenAI and delegated OpenRouter history. Preserve empty/Unicode/newline payloads and supported metadata/function groups in single captures; downstream immutable snapshots resist mutation. Mixed/duplicate/malformed/nonassistant/unknown parts and simultaneous explicit scalar refusal reject early as a bounded local ambiguity restriction without invented precedence. Native Anthropic/Gemini reject canonical refusal pre-secret; existing delegated ordinary streams remain supported, tool/direct streams remain open. Pending tool integrity, auth/IAM/Deny/limits, required usage/audit, safe failures, unknown usage and operational privacy remain shared. Actual OpenAI SDK sockets cover both routes/bases and delegated ordinary streams. OpenRouter SDK rejects raw parts but accepts canonical scalar refusal, so this is client translation rather than raw-array conformance. Pin v18 is unchanged; no fresh OpenRouter full-source comparison or complete #116 certification is asserted. See [plan](plans/332-refusal-parts.md) and [contract](../contracts/client-refusal-parts.md).

## Content-part capture consistency

The public HTTP content normalizer captures fixed indexed part positions before validation and each supported discriminator/payload once. Normalization uses only the first validated value; no second-value coercion or retry occurs, and array replacement/append during field validation cannot change captured positions. Preserve exact text/refusal JSON shapes, own refusal fields, existing inherited text behavior, dense/exact validation and downstream immutable snapshots. HTTP JSON cannot contain getters; public helper regressions reproduce the defect without a claimed network exploit. Existing provider/SDK/security/accounting/privacy paths stay unchanged, and all four established text mappings retain canonical values over both bases. Pin v18 stays unchanged; full #116 certification remains open. See [plan](plans/334-content-part-capture.md) and [contract](../contracts/content-part-capture.md).

## Function history capture consistency

Public history snapshots capture fixed message/call positions and used fields once. The same validated call IDs drive uniqueness, pending registration and output, and the same result ID drives matching and output; function names/arguments and own call arrays retain their first captures. Invalid first values reject without retries. Dense/exact/bounded arrays, complete groups, own optional markers and existing inherited required fields remain unchanged; immutable snapshots resist credential-await mutation. Public accessor and direct/delegated adapter regressions verify exact payloads or safe pre-secret failure. HTTP JSON has no getters, so no network exploit is claimed. Existing auth/IAM/Deny/limits/persistence/privacy/accounting/SDK behavior and pin v18 stay fixed; full #116 certification remains open. See [plan](plans/336-function-history-capture.md) and [contract](../contracts/function-history-capture.md).

## Function tool control capture consistency

Public tool declaration/choice snapshots capture fixed positions/length and used definition fields once, validating and freezing only first values. Declared/selected names, descriptions, strict and parameter references cannot drift between checks and projection. Optional undefined omission, exact/plain/dense/name/count limits and deep frozen schema copies stay unchanged. Shared JSON arrays use one length while descriptor-based nested accessors, cycles, depth/node budgets and response-format consumers retain their gates. Direct/delegated regressions verify exact payloads through credential mutation or safe pre-secret failure. HTTP JSON has no accessors, so no network exploit is claimed. Existing provider/policy/auth/IAM/limits/persistence/privacy/accounting/SDK contracts and pin v18 stay fixed; full #116 certification remains open. See [plan](plans/338-function-tool-capture.md) and [contract](../contracts/function-tool-capture.md).

## Assistant function response capture consistency

The shared non-streaming assistant normalizer captures the call count, fixed entries and used call/function fields once, then validates and projects the same values. Legacy function_call is captured once. Preserve unique IDs, the 128-call cap, exact argument strings, unknown-field omission, inherited scalar projection and existing finish/content/refusal gates. Both provider adapters sanitize normalization exceptions with possibly-billed failure accounting. Regressions exercise local accessor-backed provider responses on both HTTP bases; JSON itself cannot contain accessors. IAM, explicit Deny, limits, persistence, privacy, SDK behavior and pin v18 stay unchanged. Full #116 compatibility, native and tool-stream support remain open. See [plan](plans/340-function-response-capture.md) and [contract](../contracts/function-tool-responses.md).

## Stop sequence capture consistency

The shared stop snapshot uses one validated zero-to-four array count and reads indexed strings once, ignoring caller iterators. Length changes/appended entries cannot expand the captured range, and invalid/throwing captures fail safely before secrets across all four adapters. Preserve literal Unicode/string/null/empty behavior, inherited indexed lookup for local arrays, frozen copies and existing native stop/output-limit mappings. HTTP JSON cannot carry the local accessor/Proxy/iterator inputs used in regressions; no network exploit is claimed. Shared IAM/Deny/limits/persistence/privacy/accounting and pin v18 remain unchanged. Model-specific stop capabilities and complete #116 compatibility remain open. See [plan](plans/342-stop-capture.md) and [contract](../contracts/client-stop-sequences.md).

## Internal streamed function fragments

A separate internal function-stream decoder validates partial tool_calls alongside existing delegated chunk metadata and model/alias scope. Required indices and optional nonnullable IDs/type/function name/arguments preserve empty fragments without assembly or execution. The 128-entry/index subset, per-chunk uniqueness and exact keys are explicit local restrictions. Deeply frozen fragments, tool-bearing usage rejection, fixed errors and bounded SSE/SDK regressions are covered. Existing text decoder and public HTTP/provider tool-stream guards stay closed; authorization, limits, audit/usage and privacy execution remain unchanged. Sequence assembly/termination, call/finish consistency, accounting integration, client SSE/cancellation and external-tool workflows remain under #116. Pin v18 is unchanged and the transitive ChatStreamToolCall drift gate stays open. See [plan](plans/344-function-stream-chunks.md) and [contract](../contracts/function-stream-chunks.md).

## Internal function stream sequence assembly

A separate sequence assembles decoded argument fragments by index and validates stable IDs/type/names, dense complete unique calls, tool/finish and cross-chunk refusal consistency. Success requires terminal, matching usage and DONE; errors/incomplete ordering stay safely possibly billed. A shared 1,048,576 UTF-16-unit local budget bounds retained call data; private state clears on failure/end. Completed calls are frozen response content, never operational audit/usage metadata; missing/invalid usage stays unknown. Existing text/public HTTP/provider stream guards and IAM/limits/persistence/privacy/accounting execution remain unchanged. Consumer/transport/SSE/cancellation/accounting integration, transitive tool schema drift and full #116 workflows remain open. See [plan](plans/346-function-stream-sequence.md) and [contract](../contracts/function-stream-sequence.md).

## Internal function stream consumer

The internal function consumer composes bounded SSE, decoded fragments and complete sequence assembly with awaited delta delivery and a captured model scope. It returns calls/usage only after terminal/usage/DONE, cancels/releases readers on early termination and sanitizes framing/order/transport/callback/cancellation failures. Explicit discard clears private calls on external failure. Pending reads/callbacks honor cancellation; late callback rejections stay observed. Response-bearing calls/deltas never become operational audit/usage metadata. Original text consumer and public tool-stream guards, IAM/limits/persistence/accounting/privacy execution remain unchanged. Transport/accounting/client SSE integration, transitive schema drift and complete #116 workflows stay open; pin v18 is unchanged. See [plan](plans/348-function-stream-consumer.md) and [contract](../contracts/function-stream-consumer.md).

## Internal function stream HTTP response boundary

A separate upstream response boundary admits only HTTP 200 SSE bodies to the scoped function consumer and preserves frozen calls/usage after complete termination. Status failures classify 429/5xx/other safely without reading bodies; malformed streams, delivery failures and cancellation retain fixed response-started/possibly-billed errors. Best-effort cleanup cannot stall safe HTTP failure. Completed calls/deltas remain response content, never operational audit/usage metadata. Original text response and public/request tool-stream guards, IAM/limits/persistence/accounting execution remain unchanged. Request adapter/client SSE/accounting integration, transitive schema drift and #116 remain open; pin v18 is unchanged. See [plan](plans/350-function-stream-response.md) and [contract](../contracts/function-stream-response.md).

## Internal scoped function stream invoker

- A separate function invoker accepts validated function declarations, choice,
  parallel controls and complete history, captured before credential awaits.
- Fixed approved upstream model/provider slugs, server-only secrets, cancellation
  and timeout handling compose the existing function HTTP response boundary.
- Invalid requests reject pre-secret; dispatched failures remain safely possibly
  billed with no retry. Existing text controls and public HTTP guards stay closed.

See [plan](plans/352-function-stream-invoker.md) and [contract](../contracts/function-stream-invoker.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Internal function stream client SSE projection

- A separate encoder preserves bounded indexed function fragments and tool_calls finish reasons using safe JSON framing. Partial arguments stay literal response content with no parsing or execution.
- Function fragments are forbidden on usage events and in the text encoder; malformed values fail with fixed errors. Missing usage emits no fabricated counts.
- Existing metadata, text, reasoning, usage and DONE projection stays shared; the public HTTP function-stream gate remains closed.

See [plan](plans/354-function-stream-sse.md) and [contract](../contracts/function-stream-sse.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Internal delegated function stream accounting composition

- Compose internal function delivery with approved model and final-provider IAM, explicit Deny, limits, required selection audit, usage handoff and attempt audit.
- Deliver awaited function frames with frozen identity-only metadata; project the completed result to accounting-only fields without reading or retaining toolCalls.
- Return final usage and DONE only after required persistence succeeds. Missing usage stays unknown; dispatched, cancellation and output failures remain sanitized and possibly billed, without retry.
- Public HTTP function streams remain disabled; no function execution or new permission authority is introduced.

See [plan](plans/356-delegated-function-stream.md) and [contract](../contracts/delegated-function-stream.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Controlled function HTTP stream responses

- A separate function HTTP response entry point uses the existing awaited bounded body handoff, cancellation and safe JSON or SSE error envelopes.
- Function fragments are delivered as response content with identity-only error metadata; failure after delivery records a content-free stream interruption without replay.
- Required usage/audit persistence precedes final usage and DONE. IAM/limit denial emits safe JSON before frames. Public request activation remains subsequent work.

See [plan](plans/358-function-http-stream.md) and [contract](../contracts/function-http-stream.md).
Public HTTP function streams, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Delegated public function stream activation

- Both chat bases accept validated function declarations, choice, parallel controls and complete histories when a trusted function-stream invoker is installed. Text-only installations retain early tool rejection; managed direct streaming stays unsupported.
- Select the function coordinator for supplied tool controls/history, or for function-only installations; ordinary text requests retain the text path when installed.
- Persisted dual-route composition installs the function adapter using server credentials and verified mappings. Authentication, model/provider IAM including Deny, limits and required audit/usage precede or gate delivery as before.
- Safe errors, bounded flow control, cancellation, unknown usage and content-free operational records stay shared. Earlier internal-stage gate descriptions are superseded by this delegated activation; external SDK workflows and complete compatibility remain subsequent work.

See [plan](plans/360-public-function-stream.md) and [contract](../contracts/public-function-stream.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Official SDK streamed function workflow conformance

- Installed OpenAI 7.23.0 and OpenRouter 1.4.18 clients are verified on real local sockets over both chat bases with interleaved indexed function fragments and a subsequent complete tool-result request.
- Re-evaluate authentication, model/provider IAM and limits on each request; verify Deny prevents the second call and secrets. Usage/audit persistence gates final success, missing usage stays unknown, safe failures do not replay, and SDK cancellation reaches the upstream read.
- Response arguments stay out of operational records. This test-only stage changes no production behavior, SDK versions or pin; broader external-tool certification, direct streaming and transitive schema drift remain open.

See [plan](plans/362-sdk-function-stream.md) and [contract](../contracts/sdk-function-stream.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v18 is unchanged.

## Installed client error and cancellation behavior

OpenAI 7.23.0 may end iteration normally after explicit client abort; the gateway
still cancels the upstream read and records failed possibly-billed usage and an
interruption. OpenRouter 1.4.18 can yield a structured error chunk on /api/v1
after partial output, while its legacy /v1 parser rejects the legacy error
envelope. A yielded error must be treated as failure by consumers; the gateway
withholds final usage and DONE after required persistence or upstream failure.
Conformance verifies error signaling and server accounting, not identical SDK
exception behavior. No production or SDK version changes are made here.

## Streamed function fragment schema drift selection

- Extend selected streaming definitions from four to five by pinning the entire ChatStreamToolCall definition, including its inline function name and arguments. Keep 23 request fields and all other selected maps unchanged.
- Preserve verified canonical source provenance from the cached 2026-10-04 official document; version 19 records the expanded projection, not a fresh full-source comparison.
- Detect unchanged-parent nested structural drift and malformed or rehashed stale/extra/missing maps; editorial annotations remain ignored. Runtime bounds and exact-key rules remain local restrictions without invented source limits.
- No service, IAM, audit, usage or request behavior changes. Named external-tool and broader structural coverage remain open under #116.

See [plan](plans/364-stream-fragment-drift.md) and [contract](../contracts/stream-fragment-drift.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 tracks five selected stream definitions.

## Isolated OpenCode text conformance

Register a custom @ai-sdk/openai-compatible provider with an explicit proxy-token environment reference and chosen model. Verify installed OpenCode 1.18.5 with an opt-in local socket runner over both bases, fresh temporary config/data/cache/work directories, bounded lifetime and cleanup. Do not write real user configuration or call a real upstream. Named-client model registration is explicit and does not claim automatic GET models discovery. This first test subject is reversible; broader clients and #116 remain open.

See [plan](plans/366-opencode-text-conformance.md) and [contract](../contracts/opencode-text-conformance.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 tracks five selected stream definitions.

## OpenCode streamed tool lifecycle and controls

Extend installed OpenCode 1.18.5 conformance over both bases with incremental read-function fragments, an actual temporary fixture-file read and correlated tool-result continuation. Evaluate fresh IAM and limits for every request; verify explicit model and provider Deny before secrets and process-termination cancellation with failed accounting. Restrict reads to the single temporary fixture, deny all other tools and external skills, and retain bounded child lifetime/output and cleanup. No product API, provider routing or schema behavior changes; broader app cancellation/failure semantics, direct streaming and full #116 remain open.

See [plan](plans/367-opencode-tool-conformance.md) and [contract](../contracts/opencode-tool-conformance.md).
Further client conformance, transitive schema drift and full #116 remain open;
pin v19 is unchanged.

## Direct OpenAI text-stream transport preparation

Expose an internal fixed-host direct OpenAI text-stream transport. Reuse existing native request controls and administrator output caps; capture approved candidate identity, client alias and complete prepared body before awaiting secrets. Nonstream adapters use the same captured scope. Always request include_usage for internal streams; reject other provider kinds and tool declarations/history before credentials. Support cancellation/deadline while awaiting secrets and fetch without inference retry. Response consumption and public managed streaming follow separately.

See [plan](plans/370-direct-stream-transport.md) and [contract](../contracts/direct-stream-transport.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Native direct OpenAI text-stream response boundary

Consume an already-opened direct OpenAI SSE response with native text/refusal guards, usage:null ordinary chunks and exactly one empty-choice final usage event before DONE. Reuse bounded framing and validated sequence primitives while rejecting delegated reasoning/native-finish extensions and tools. Capture exact approved model scope; require stable response identity and preserve unknown final usage. Await delivery, interrupt on cancellation and classify HTTP/stream failures as response-started and possibly billed without reading failure bodies. Unsuffixed-to-snapshot identity mapping, other native modalities/providers and public managed streaming remain open.

See [plan](plans/371-direct-openai-stream-response.md) and [contract](../contracts/direct-openai-stream-response.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Internal direct OpenAI text-stream invoker

Compose the captured direct OpenAI transport and native SSE response boundary into an internal text/refusal invoker. Preserve fixed registered host, exact approved upstream identity and immutable client alias, existing controls/caps, forced native final usage, awaited callback delivery and deadline/cancellation. Return a content-free native completion only after terminal/usage/DONE; failures retain sanitized categories and response-started/possibly-billed semantics with no inference replay. Unsupported providers/tools reject before secrets. The caller must already authorize the managed candidate; public managed IAM/limits/usage/audit streaming composition, identity alias equivalence and other native providers remain subsequent work.

See [plan](plans/373-direct-openai-stream-invoker.md) and [contract](../contracts/direct-openai-stream-invoker.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Managed text stream coordination

Compose authorized managed candidates with the trusted direct OpenAI text stream port. Preserve model and final-provider IAM, limits, Jev/order selection, per-attempt metadata-only usage and required audit. Deliver scoped text frames with awaited backpressure; expose final usage/DONE only after successful usage and audit. Never retry after any emitted delta or cancellation. Public HTTP activation remains a subsequent increment.

See [plan](plans/376-managed-text-stream.md) and [contract](../contracts/managed-text-stream.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Controlled managed HTTP stream delivery

Reuse the existing single-pending-frame HTTP controller for managed text streams. Preserve awaited delivery, zero high-water mark, cancellation, metadata-only interruption audit and post-accounting final frame gates. Project managed provider/credential/usage/audit failures safely for OpenAI and OpenRouter formats; public gateway activation is a subsequent increment.

See [plan](plans/378-managed-http-stream.md) and [contract](../contracts/managed-http-stream.md).
Public managed streaming and full #116 remain open; pin v19 is unchanged.

## Public managed OpenAI text streaming

Activate managed OpenAI text/refusal streaming through an optional trusted gateway port on both /v1 and /api/v1 and generate that port from stored native registrations in persisted direct/dual servers. Retain complete model/final-provider IAM, limits, Jev/order selection, required usage/audit and bounded cancellation. Reject managed tools/tool histories before inference; unsupported native registrations fail before provider-key lookup without silently changing candidate selection. Exact upstream model IDs remain required. Native tools, Anthropic/Gemini streaming and full #116 remain open.

See [plan](plans/380-managed-gateway-stream.md) and [contract](../contracts/managed-gateway-stream.md).
Managed OpenAI text streaming is activated; broader native streaming and full #116 remain open. Pin v19 is unchanged.

## Native OpenAI function stream response validation

Consume native OpenAI indexed function deltas through bounded framing and the existing function sequence. Preserve exact model scope and stable response identity/timestamp. Ordinary usage:null is a delta extension, final empty-choice usage is required before DONE. Completed calls remain response content; rich/custom/deprecated fields fail safely. Classify opened-stream failures as possibly billed and cancel body on delivery failure or abort.

See [plan](plans/382-native-function-response.md) and [contract](../contracts/native-function-response.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Registered OpenAI function stream invoker

Introduce an explicit function-stream mode on captured direct request transport. Reuse validated OpenAI tools/choice/parallel controls and correlated result history, fixed registered host, output caps, immutable pre-secret scope/body, timeout and cancellation. Compose native function response validation. Preserve text-only rejection and fail unsupported kinds/invalid controls before keys. No inference retry in the adapter.

See [plan](plans/384-native-function-invoker.md) and [contract](../contracts/native-function-invoker.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Managed function stream coordination and HTTP delivery

Compose trusted native function streams with existing managed IAM, limits, Jev/order selection, per-attempt usage and required audit. Explicitly exclude completed tool calls from routing/accounting responses. Gate usage/DONE after required handoffs, retain safe pre-output fallback accounting and prohibit retry after output/cancellation. Add a function entry point on the shared bounded HTTP controller with safe interruption projection.

See [plan](plans/386-managed-function-stream.md) and [contract](../contracts/managed-function-stream.md).
Managed OpenAI text streams remain supported. Public managed function streaming and full #116 remain open; pin v19 is unchanged.

## Public managed OpenAI function streaming

Activate the trusted native function stream port on both chat bases and generate it from stored native registrations in direct/dual PostgreSQL servers. Preserve authentication, complete model/final-provider IAM, limits, Jev/order selection, accounting/audit gates, no replay and cancellation. Both installed SDKs must complete two interleaved calls and correlated tool-result continuation on both bases with fresh Deny, persistence errors, unknown usage and abort. Keep exact native model IDs and rich/custom/server-tool/other-native-provider gaps open.

See [plan](plans/388-public-managed-functions.md) and [contract](../contracts/public-managed-functions.md).
Managed OpenAI text streams remain supported. Managed OpenAI function streams are activated; broader compatibility and full #116 remain open. Pin v19 is unchanged.

## OpenCode managed native streaming conformance

Extend isolated OpenCode 1.18.5 probes from delegated routes to managed OpenAI text/function streams on both bases. Verify explicit custom-provider/model registration, text rendering, real fixture-only read-function execution and correlated result continuation, fresh IAM/limits, model/provider Deny and process-disconnect billed/missing accounting. Preserve fixed mocked upstream, isolated temporary Git/config/env and bounded process output/time. Default CI verifies both fixture route kinds; the installed-client gate runs 20 probes.

See [plan](plans/390-opencode-managed-streams.md) and [contract](../contracts/opencode-managed-streams.md).
Managed OpenAI text/functions remain supported. Broader named-client cases and full #116 remain open; pin v19 is unchanged.

## Native Anthropic text response validation

Internal response-only preparation validates native Anthropic text SSE, exact model identity, sequential blocks, cumulative aggregate usage, safe failure and cancellation. Anthropic transport, public activation, functions, reasoning and server tools remain follow-up work.

See [plan](plans/392-anthropic-text-response.md) and [contract](../contracts/anthropic-text-response.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.

## Registered Anthropic text stream invocation

Internal native Anthropic text invocation uses an explicit transport mode, captured administrator registration and Messages request, fixed host and headers, capped output, timeout and caller cancellation. Existing OpenAI-only stream modes remain restricted. This stage does not yet wire persisted public Anthropic streams or tools.

See [plan](plans/393-anthropic-text-invoker.md) and [contract](../contracts/anthropic-text-invoker.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.

## Managed Anthropic public text streaming

Public managed Anthropic text streaming is activated through a captured registration-kind dispatcher and generated persisted direct/dual handlers. Both API bases and actual OpenAI/OpenRouter SDK text consumption preserve authentication, model/provider Deny, limits, required usage/audit, cancellation and safe partial failure. Gemini and Anthropic functions/thinking/server tools remain unsupported.

See [plan](plans/395-anthropic-managed-stream.md) and [contract](../contracts/anthropic-managed-stream.md). OpenAI managed text/function support remains in place; full #116 compatibility and #7 unresolved decisions remain open. Pin v19 is unchanged.

## Managed Gemini public text streaming

Add bounded native Gemini text SSE validation, an explicit registered Google streaming transport and generated managed text dispatch through both API bases and persisted direct/dual composition. Preserve exact approved version scope, stable response identity, native output caps, authentication, model/provider Deny, limits, required usage/audit and cancellable backpressure.

See [plan](plans/398-gemini-managed-stream.md) and [contract](../contracts/gemini-managed-stream.md). Exact native version identity and final reported Google totals are required; functions/thoughts/signatures/server tools and full #116 remain open. Pin v19 is unchanged.

## Gemini reported-only aggregate totals

Native Google nonstream text and supported prompt/candidate safety outcomes preserve only supplied totalTokenCount. Missing total stays partial despite known prompt/candidate counters; hidden thinking prevents deriving their sum. Both API bases, known/invalid counters, provider regressions and operational secrecy are covered. See [plan](plans/399-google-reported-totals.md) and [contract](../contracts/direct-usage-availability.md). Full #116 remains open.

## Managed Anthropic nonstream client functions

Registered Anthropic nonstream routes now map bounded custom function declarations, choice/parallel controls, mixed text/tool_use responses and complete correlated tool-result histories on both API bases. Adjacent parallel results form one native user turn; argument inputs are bounded JSON objects. Preserve immutable pre-secret bodies, authentication, model/final-provider IAM, limits, required aggregate usage/audit and safe failures. Tools execute only in the external client. Persisted direct/dual servers and both installed SDKs are covered by fixture tests.

See [plan](plans/402-anthropic-client-functions.md) and [contract](../contracts/anthropic-client-functions.md). Anthropic function streaming, native thinking/server tools, Gemini functions and broader named-client conformance remain open. No live-provider certification or complete #116 compatibility is claimed; #7 remains unresolved and pin v19 is unchanged.

## Managed Anthropic client function streaming

Activate registered Anthropic Messages function streams on both compatible bases and in generated persisted direct/dual handlers. Validate exact native model identity, sequential text/tool blocks, bounded JSON-object argument assembly, dense compatible tool indices and cumulative usage; require complete native terminal order. Preserve authentication, complete model/final-provider IAM and Deny, limits, immutable pre-secret requests, required usage/audit, cancellation and no replay. Completed calls remain private response content; the gateway never executes them. Both installed SDKs complete two Unicode calls and correlated result continuation through fixture sockets.

See [plan](plans/404-anthropic-function-streams.md) and [contract](../contracts/anthropic-function-streams.md). No-delta empty tool inputs retain the official SDK placeholder; incomplete/invalid arguments and tool-bearing max_tokens responses fail this complete-call subset safely. Native thinking/server/rich tools, Gemini functions, model equivalence and broader named-client conformance remain open. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Bounded managed Gemini nonstream client functions

Registered generateContent routes now translate bounded custom declarations, choice modes, signature-free mixed text/function calls and complete correlated text-result histories on both API bases. Results preserve exact strings and original call order; native IDs remain exact and missing IDs use reserved local correlation IDs omitted on native replay. Function paths request thinkingBudget:0 and reject explicit reasoning conflicts, strict:true and unenforceable parallel:false controls before keys (NONE remains valid). Signature/thought/rich or incomplete native calls fail safely; no tool executes inside the gateway. Preserve complete model/provider IAM, limits, immutable secret boundaries, reported-only Google totals and required usage/audit.

See [plan](plans/406-gemini-client-functions.md) and [contract](../contracts/gemini-client-functions.md). Both installed SDKs and persisted direct/dual servers exercise fixture round trips and fresh Deny. Native function streams, thinking/signature replay, models requiring thinking, strict/single-call equivalence and broader named clients remain open. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Bounded managed Gemini function streaming

Registered streamGenerateContent routes now emit bounded complete custom function objects and text on both compatible bases through the captured registration dispatcher and generated persisted direct/dual servers. Validate exact initial model/response identity, whole events before delivery, dense indices, unique native IDs, reserved missing-ID replay, bounded objects and clean terminal/EOF. Preserve existing signature-free thinking controls, fixed hosts, administrator caps, model/final-provider IAM and Deny, limits, pre-secret immutability, cancellation, required usage/audit and reported-only Google totals. Tools execute only in external clients.

See [plan](plans/408-gemini-function-streams.md) and [contract](../contracts/gemini-function-streams.md). Both installed SDKs cover Unicode calls, results, missing IDs, fresh Deny, failure gates and abort through fixture sockets. Partial argument streaming, thinking/signature replay, models requiring thinking, strict/single-call equivalence and broader named clients remain open. This is not live-provider certification. Full #116 and unresolved #7 remain open; pin v19 is unchanged.

## Managed Gemini nonstream function thought signatures

Managed Gemini nonstream function calls now preserve exact bounded Part.thoughtSignature metadata as the documented tool_calls[].extra_content.google.thought_signature extension and replay it on the same native call part. Preserve parallel/sequential call association, reserved missing-ID semantics, immutable pre-secret history, complete model/provider IAM and Deny, limits, required usage/audit, reported-only totals and metadata privacy. Invalid/oversized signatures fail safely; other native/delegated adapters and native text streams reject this extension before keys. Signed text and visible thought content remain unsupported.

See [plan](plans/410-gemini-function-signatures.md) and [contract](../contracts/gemini-function-signatures.md). Raw HTTP and installed OpenAI SDK socket/persisted direct/dual probes exercise exact replay and fresh Deny. Installed OpenRouter 1.4.18 strips tool-call extra_content; socket tests measure lost-signature continuation failure, so signed Gemini SDK compatibility is still incomplete. No reasoning-detail/tool association is invented. Existing thinkingBudget:0 and effort conflict remain; signed text, standalone signature chunks, models requiring thinking and broader clients stay open. Full #116 and unresolved #7 remain open; pin v19 is unchanged and fixture tests do not certify live providers.

## Managed Gemini function signature streams

For #412, native Google function streams preserve complete same-part thoughtSignature values as tool_calls[].extra_content.google.thought_signature in client deltas, completed calls and signed history replay on both bases. Retain original parallel/sequential association and missing-ID semantics. Trusted outbound projection admits this exact frozen extension; unrelated inbound decoders and adapter histories remain closed. The shared one-MiB retained string-unit budget now includes signatures with IDs, names and arguments; conflicts and malformed/overflow content discard private assembly.

Raw HTTP, installed OpenAI 7.23.0 raw SDK streams and stored direct/dual probes cover signed calls, fresh Deny, limits, required usage/audit failure and privacy. Installed OpenRouter 1.4.18 strips the extension; measured missing-signature continuation fails safely, so signed Gemini OpenRouter SDK compatibility remains incomplete. Native signed text, thoughts, partial arguments and standalone late signatures remain unsupported; no reasoning-detail/tool bridge or model eligibility/default change is inferred. Function requests retain thinkingBudget:0 and effort conflict. Completion still requires supported terminal and clean framed EOF; signatures stay out of operational errors, ledger and audit metadata.

See [plan](plans/412-gemini-signature-streams.md) and [contract](../contracts/gemini-signature-streams.md). This supersedes the prior nonstream signature contract's native function-stream exclusion only. Full #116 and unresolved #7 remain open; pin v19 is unchanged and fixture conformance is not live-provider certification.

## OpenCode managed Anthropic and Gemini conformance

For #414, extend the pinned OpenCode 1.18.5 conformance harness to administrator-registered managed Anthropic/Gemini fixtures on both API bases, retaining delegated/OpenAI probes. Verify explicit custom-provider/model registration, rendered text, real fixture-only read execution, native correlated result continuation, administrator output caps, fresh per-request IAM/limits, initial model/provider Deny, follow-up provider Deny, cancellation with possibly-billed missing usage and private operational metadata. Fixed mocked hosts, secret references, environment allowlist, isolated temporary Git/config/data, exact read permission, disabled plugins/external config, bounded process output/time and cleanup remain enforced.

The pinned OpenCode OpenAI-compatible SDK loses signed Google call metadata with the default custom-provider namespace. Explicit provider.opengranter.options.name="google" preserves complete same-part signatures while keeping model="opengranter/chat", the gateway baseURL and proxy token. This selects the SDK metadata namespace only; it grants no model/provider IAM authority, changes no registered destination and is not a universal client default. Probe both safe failed native default continuation and configured successful signed replay. OpenCode's outer session policy retries 5xx without a cap; deliberately terminate the default negative probe at the existing five-second process deadline and verify unsigned result replay plus failed possibly-billed missing accounting, without claiming immediate terminal client error or normal completion. Later signature-only chunks, thinking-model eligibility, automatic discovery, other clients/versions and live-provider certification remain outside this subset. Installed OpenRouter 1.4.18 signature stripping remains an independent gap.

See [plan](plans/414-opencode-native-providers.md) and [contract](../contracts/opencode-native-providers.md). Full #116, unresolved #7 and pin v19 remain unchanged.

### Explicit signed-Google OpenCode configuration

Use this option only for a known administrator-published native Google route requiring the supported complete same-part signature subset. Keep the usual explicit provider/model registration and use the user's proxy token:

```json
{
  "model": "opengranter/chat",
  "provider": {
    "opengranter": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "name": "google",
        "baseURL": "https://<gateway-host>/api/v1",
        "apiKey": "{env:OPENGRANTER_PROXY_TOKEN}"
      },
      "models": {
        "chat": { "name": "Published Google alias" }
      }
    }
  }
}
```

Replace chat with the exact published alias in both model registration and model selection; the option does not publish or infer model eligibility. Pin-specific behavior is evidenced by the [OpenCode factory](https://raw.githubusercontent.com/anomalyco/opencode/v1.18.5/packages/opencode/src/provider/provider.ts) and [OpenAI-compatible SDK history converter](https://raw.githubusercontent.com/vercel/ai/@ai-sdk%2Fopenai-compatible@2.0.41/packages/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts), and must pass actual isolated socket probes.

Pinned installed-client validation npm run compatibility:opencode -- /Users/jungwon/.opencode/bin/opencode passes fifty probes: ten delegated/OpenAI cases, thirty-six managed OpenAI/Anthropic/Google cases including follow-up Deny, and four Google signature probes across both bases. Forty-six ordinary/Deny/cancel probes, two intentionally bounded default-signature loss probes and two configured signed successes are separately verified. Configured Google probes execute read, preserve exact signature replay and render final completion. Default probes verify unsigned native replay and failed possibly-billed missing accounting before deliberate five-second termination; they do not certify default signed success or a final client error. The default CI socket/process suite passes sixty-three cases, including thirty-seven added regressions. This is fixture conformance, not live-provider certification.

## Gemini informational cached and reasoning usage

For #416, supported managed Google nonstream text/safety/function completions and text/function streams preserve supplied cachedContentTokenCount as prompt_tokens_details.cached_tokens and thoughtsTokenCount as completion_tokens_details.reasoning_tokens on both chat bases. Accept nonnegative safe integers including zero; native absent/null/invalid categories remain omitted independently. Ignore native modality/tool/cost fields and OpenAI-shaped groups. Capture immutable allowlisted snapshots.

Preserve native aggregate availability and reported totals without derivation, sum/subset inference, cached subtraction or thought addition. Details alone cannot manufacture usage. Compatible nonstream /api/v1 omits incomplete usage; legacy sparse usage remains available. Final streams take details only from terminal usage or its allowed replacement tail, never earlier snapshots or merged groups, and emit final usage/DONE only after required ledger/audit persistence. Existing IAM, limits, registered hosts, cancellation and per-attempt aggregate accounting remain shared; categories are client-only and stay out of operational records.

No thinking/default/eligibility, cached-content request, native thought-body, category ledger, SDK or schema pin change. Anthropic/modality/server-tool categories, detailed billing, full #116, live-provider certification and unresolved #7 remain open. See [plan](plans/416-gemini-token-details.md) and [contract](../contracts/gemini-token-details.md). Source: [Gemini UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata).

## Anthropic cache-aware native usage

For #418, managed Anthropic nonstream text/refusal/functions and text/function SSE include reported disjoint cache_creation_input_tokens and cache_read_input_tokens in native prompt normalization once, then derive prompt+output total within safe integer bounds. Expose valid cache reads/writes as optional prompt_tokens_details.cached_tokens/cache_write_tokens without adding projected categories again. New per-attempt aggregate ledger records receive the corrected totals; category fields stay client-only and establish no billed-cost authority.

Both cache fields wholly absent retain the historical bounded input/output-only mapping, which does not certify complete cache reporting. If initial/nonstream cache reporting is present, missing/null components leave prompt/total unavailable; malformed/overflow counts or sums make prompt invalid. Known cache details alone cannot manufacture input or total usage. Stream input/cache counters preserve prior values across omitted/null deltas and replace supplied nonnull cumulative updates, never sum event snapshots. Final output comes from the latest message_delta, without initial-estimate fallback.

Shared authentication, complete model/provider IAM/Deny, limits, fixed hosts, cancellation, privacy and required usage/audit before final usage/DONE remain enforced. Historical records, pricing, cache requests/defaults, thinking/models, schema/SDK pins, live-provider certification, full #116 and unresolved #7 remain outside this bounded fix. See [plan](plans/418-anthropic-cache-usage.md) and [contract](../contracts/anthropic-cache-usage.md). Sources: [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and [official accumulator](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/lib/MessageStream.ts).
