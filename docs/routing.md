# Routing and Authorization Contract

Status: Product behavior agreed at the level below. Exact score weights, retryable errors, streaming, and external API field coverage remain open. Updated 2026-09-27.

## Public request and route plan

Callers use an OpenAI-compatible chat endpoint with an OpenGranter proxy token and a model alias. OpenGranter resolves the alias to a versioned route policy. That policy names a route kind (`delegated` or `managed`), an approved set of model and inference-provider pairs, optional provider order, price ceiling, and selection preference. Client-supplied routing preferences may narrow the approved set, but cannot add a model, provider, endpoint, region, credential, or route kind. Unknown routing fields fail validation before any upstream call.

The route planner produces an immutable plan for the request: policy version, alias, allowed pairs, eligible candidates, selected candidate, and fallback sequence. Every attempted candidate gets a separate attempt record linked to one client request ID. A policy change applies to the next request; a request already admitted uses the recorded version for its lifetime.

## Candidate authorization

For each candidate pair, evaluate `llm:InvokeModel` on `model:<alias>` and `llm:UseProvider` on `provider:<inference-provider-id>`. Both must Allow and neither may have a matching Deny. A denied provider removes that candidate; it does not necessarily deny an alias that has another permitted provider. If no candidate remains, return 403 and write a denial event. The model list endpoint shows an alias only if at least one currently eligible candidate exists.

For a delegated candidate, OpenRouter is the upstream but `provider:<id>` refers to the eventual inference provider, not OpenRouter itself. OpenGranter must constrain OpenRouter to the authorized provider set with a server-generated `provider.only` restriction and verify that the configured OpenRouter key/workspace guardrail does not broaden it. A caller cannot replace or widen `provider.only`. If a model can reach a provider that cannot be bounded before the call, reject that route. OpenRouter documents request-level `provider.only` and cumulative account restrictions. [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [Guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview).

OpenRouter's `models` fallback array is not forwarded as an unchecked array. OpenGranter evaluates each model and provider set separately and, if model fallback is enabled, issues sequential bounded attempts. This prevents one shared provider allowlist from allowing a provider for the wrong model. OpenRouter may still choose and retry providers within the authorized `provider.only` set for the current model. [Model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks).

## Selection and fallback

For managed routes, filter by policy, capability, administrator restrictions, price ceiling, and current health. The initial default prefers healthy candidates with lower estimated price and keeps remaining eligible candidates as an ordered fallback list. Administrators can instead specify a strict provider order or sort by price, measured latency, or measured throughput. A metric's source, age, and missing-data rule must be exposed; a missing metric must not silently make an ineligible provider eligible. This resembles OpenRouter's published selection controls without claiming its exact algorithm. [OpenRouter provider selection](https://openrouter.ai/docs/guides/routing/provider-selection).

Fallback can move to another already-authorized candidate within the same route kind. A delegated request may continue only on delegated candidates; a managed request may continue only on managed candidates. A cross-kind switch requires a new explicit client request or a later product decision. Re-evaluate no new candidates during retry, and never use a caller-supplied upstream URL. Automatic retry after response bytes have reached the client is disabled; interrupted streams record uncertain usage until reconciled. Retryable status codes, maximum attempts, and budget reservations remain to be specified.

## Provider adapters

The public contract is a tested subset of OpenAI Chat Completions, not a claim of full parameter compatibility. Each upstream adapter declares capabilities and maps request, response, streaming events, usage, and errors. A request that no eligible adapter can represent must fail before invocation. Initial adapters are:

| Upstream | Native API shape | Adapter responsibility |
| --- | --- | --- |
| OpenRouter | OpenAI-compatible chat API | Bound model/provider routing and preserve generation metadata |
| OpenAI | Chat Completions API | Map approved fields and usage directly |
| Anthropic | Messages API | Translate messages, system content, completion limits, response and usage shapes |
| Google Gemini | `generateContent` API | Translate message roles/parts, generation settings, response and usage shapes |

Anthropic and Gemini have distinct native request shapes; a direct route to either must not merely forward the OpenAI JSON body. [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generateContent](https://ai.google.dev/api/generate-content), [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create).

## Audit and accounting

Record the plan and each attempt's route kind, model alias, upstream model, allowed provider set, selected or reported inference provider, policy version, outcome, and nonsecret credential ID. A delegated attempt also retains OpenRouter generation/request identifiers when available. Store estimated and upstream-reported cost separately. A later reconciliation may revise the reporting projection but must retain the original immutable attempt event.

## Remaining contract questions

- Exact default price-weighting or deterministic ranking formula and tie-breaking.
- Retryable errors, maximum attempts, and whether an OpenRouter internal retry counts as one or more local attempts.
- Metric freshness, health thresholds, and capability discovery.
- First supported request fields beyond text chat and whether streaming is required at launch.
- OpenRouter provider identity mapping across its endpoint slugs, BYOK routes, and the internal provider resource IDs.
