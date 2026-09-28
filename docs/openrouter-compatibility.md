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
- Current text-chat request: model plus string-content messages, optional stream false and positive-integer max_tokens. Discovery uses GET models; chat uses POST chat/completions relative to the base.

Tools with a hardcoded openrouter.ai host need a configurable endpoint or an integration change. Path aliases alone do not make tools needing streaming, function calls or advanced parameters work.

## Compatibility matrix

| Area | Current state | Remaining acceptance gate |
| --- | --- | --- |
| Base paths and Bearer token | /api/v1 chat/models aliases; shared proxy authorization | SDK and named external-tool registration tests |
| Model discovery | Authorized alias IDs and basic model fields | Context window, capability, supported-parameter and price metadata from trusted catalog sources |
| Non-streaming text chat | Text messages, one normalized text choice and max_tokens across four adapters | Remaining request/response schema, sampling, max_completion_tokens and capability metadata |
| Streaming | Not implemented | SSE framing, termination, usage, backpressure, cancellation, safe interruption/failure audit |
| Tool calling | Not implemented | Tool definitions, choice, assistant tool calls, tool results and provider mappings |
| Rich inputs and outputs | Not implemented | Content parts, modality/capability checks, structured output and reasoning handling |
| Client routing controls | Rejected today | Client preferences narrow approved model/provider scope; no arbitrary destinations or authority widening |
| Errors | Safe string codes and request ID | Source-compatible safe message/status/schema handling, including streaming errors |
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
