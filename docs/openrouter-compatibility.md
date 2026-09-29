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
- Current text-chat request: model plus string-content messages (exact text-part arrays on supported roles also normalize to strings), optional stream false, optional n=1 and positive-integer max_tokens or max_completion_tokens and optional stop (string or up to four strings), optional top_p (finite number in 0..1), and optional temperature (finite number in 0..2; direct Anthropic 0..1). Discovery uses GET models; chat uses POST chat/completions relative to the base.

Tools with a hardcoded openrouter.ai host need a configurable endpoint or an integration change. Path aliases alone do not make tools needing streaming, function calls or advanced parameters work.

## Compatibility matrix

| Area | Current state | Remaining acceptance gate |
| --- | --- | --- |
| Base paths and Bearer token | /api/v1 chat/models aliases; shared proxy authorization; pinned OpenAI SDK smoke tests | Streaming/tool SDK workflows and named external-tool registration tests |
| Model discovery | Authorized alias IDs and basic model fields | Context window, capability, supported-parameter and price metadata from trusted catalog sources |
| Non-streaming text chat | Text messages, one normalized text choice with max_tokens/max_completion_tokens and portable stop/top_p/temperature/n=1 across four adapters | Remaining request/response schema, sampling and capability metadata |
| Streaming | Not implemented | SSE framing, termination, usage, backpressure, cancellation, safe interruption/failure audit |
| Tool calling | Not implemented | Tool definitions, choice, assistant tool calls, tool results and provider mappings |
| Rich inputs and outputs | Text-only parts on system/developer/user/assistant normalize to strings | Multimodal/cached content, native block semantics, structured output and reasoning handling |
| Client routing controls | Rejected today | Client preferences narrow approved model/provider scope; no arbitrary destinations or authority widening |
| Errors | /api/v1 numeric status codes, fixed messages, safe local reason/typed metadata and request ID; legacy /v1 symbolic codes | Precise upstream error_type propagation, retry hints and streaming errors |
| Other model-use endpoints | Not implemented | Inventory completions, responses, embeddings and generation lookup against external-tool requirements and authorization |
| Operational OpenGranter APIs | Usage/audit extensions on /v1 | Keep their authorization and contracts explicit during compatibility expansion |

## Implementation sequence

1. Base paths and an integration harness: this issue.
2. Supported model metadata and standard request controls with provider capability mapping.
3. Tool-call lifecycle and structured output normalization.
4. Streaming across providers with audited interruption and unknown-usage handling.
5. Source-pinned conformance cases plus SDK and named external-tool smoke tests for the supported surface. Compatibility gaps block the release claim.

Every feature needs its own issue, English plan and red/green contract cases. Routing and privileged debug fields must retain the security invariants; accepting arbitrary JSON and forwarding it upstream does not satisfy compatibility.

## Sources checked 2026-09-28

OpenRouter documents /api/v1 with Bearer authentication and configurable SDK base URLs: [authentication](https://openrouter.ai/docs/api_reference/authentication). Its unified chat schema includes additional parameters, tools, richer messages and response fields: [API overview](https://openrouter.ai/docs/api_reference/overview). Streaming uses SSE and has distinct pre-stream and mid-stream errors: [streaming](https://openrouter.ai/docs/api_reference/streaming). The [official OpenAPI specification](https://openrouter.ai/openapi.json) is the future conformance input; schema version capture and drift checks remain to implement.

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

A provenance-checked structural pin covers thirteen source-declared chat request fields and the two supported text/json_object format definitions, required fields and request reference/document versions. The offline gate checks integrity; an explicit fixed-host network command detects selected structural drift without auto-updating the pin. Other referenced definitions and full schema instance validation remain uncovered. Version-2 pin integrity rejects stale or malformed definition maps. The retrieved ChatRequest does not declare n; local n=1 is SDK support. The four nullable token/sampling controls are supported; optional model and other broader source behaviors remain gaps. See [plan](plans/138-openrouter-schema-drift.md) and [contract](../contracts/openrouter-schema-drift.md).

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

## Client seed subset

Nullable safe-integer seed controls preserve omission defaults and values across both client bases and SDK requests. OpenAI/OpenRouter forward seed; Gemini generationConfig.seed is bounded by native signed int32, while Anthropic supplied seeds reject before credentials. Native capture, settings-only configuration and security/accounting paths are covered. Model-dependent support, deterministic output, provider fingerprint metadata and full client/tool/stream workflows remain open. Seed and top_k are now included in the reviewed source-drift allowlist; this does not guarantee runtime model support. See [plan](plans/160-client-seed.md) and [contract](../contracts/client-seed.md).

## Sampling-field source drift

The thirteen-field source projection includes seed/top_k integer/nullability structure and constraints, with missing/malformed/rehashed-map and annotation/unrelated-change coverage. Version-2 projection format and two selected format definitions remain unchanged. Native provider schemas, runtime model support, other references and full instance/response/tool/stream/client conformance remain open. See [plan](plans/164-sampling-schema.md) and [contract](../contracts/openrouter-schema-drift.md).
