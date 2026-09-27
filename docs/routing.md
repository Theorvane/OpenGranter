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

An optional Jev-assisted strategy asks TypeSafe Jev to choose among the already eligible **managed** candidate IDs. The server sends a `choice` question to `POST https://api.typesafe.ai/v1/systemone`, with one criterion per candidate and `jev-latest` as the requested model. Jev is a decision service, not the inference upstream. OpenGranter checks the returned ID and confidence before calling the registered direct provider. Jev cannot add a provider, model, endpoint, or route kind. The current decision module limits Jev to 255 distinct candidate IDs, matching the documented Choice maximum. [TypeSafe API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice).

The provisional prompt-disclosure policy sends model-alias metadata and approved candidate descriptions by default. A route setting may explicitly include prompt text; this is separate from the content-audit retention setting. The current selector uses a three-second timeout and a configured confidence threshold. On timeout, HTTP failure, malformed or ineligible choice, low confidence, or too many/duplicate candidates, it selects the first already eligible candidate in supplied administrator order and returns a nonsecret reason for audit. This fallback direction is confirmed; prompt disclosure and the Jev integration target await product-owner confirmation. An empty eligible set makes no Jev call and denies routing. A later gateway must provide the candidate set only after capability, health, limit, and IAM checks; the existing pure selector currently enforces IAM and route kind but does not perform those other checks.

Fallback can move to another already-authorized candidate within the same route kind. A delegated request may continue only on delegated candidates; a managed request may continue only on managed candidates. A cross-kind switch requires a new explicit client request or a later product decision. Re-evaluate no new candidates during retry, and never use a caller-supplied upstream URL. For the current direct adapters, automatic replay stops once an upstream HTTP response has begun; interrupted streams record uncertain usage until reconciled.

For Jev-assisted managed routes, Jev selects the first candidate only once. If its decision fails, begin with the first eligible candidate in administrator order. If the selected direct adapter explicitly reports a retryable failure before any upstream response begins, try the remaining eligible managed candidates in administrator order, once each; do not ask Jev again. The current adapters mark HTTP 429 and 5xx responses as response-started, so those statuses stop automatic replay even before any bytes reach the client. A pre-response timeout may retry. Unclassified errors, authentication/validation/moderation failures, and other response-started failures stop fallback. Persist each failed attempt before trying the next. A retry may incur duplicate upstream cost, so carry possible-billing information through the attempt events and final result. Maximum attempts equal the eligible candidate count; budget reservation across those attempts remains to be specified.

## Provider adapters

The public contract is a tested subset of OpenAI Chat Completions, not a claim of full parameter compatibility. Each upstream adapter declares capabilities and maps request, response, streaming events, usage, and errors. A request that no eligible adapter can represent must fail before invocation. Initial adapters are:

| Upstream | Native API shape | Adapter responsibility |
| --- | --- | --- |
| OpenRouter | OpenAI-compatible chat API | Bound model/provider routing and preserve generation metadata |
| OpenAI | Chat Completions API | Map approved fields and usage directly |
| Anthropic | Messages API | Translate messages, system content, completion limits, response and usage shapes |
| Google Gemini | `generateContent` API | Translate message roles/parts, generation settings, response and usage shapes |

Anthropic and Gemini have distinct native request shapes; a direct route to either must not merely forward the OpenAI JSON body. [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generateContent](https://ai.google.dev/api/generate-content), [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create).

The current direct adapters implement text-only, non-streaming chat through fixed official hosts. Administrator registrations map an inference provider ID to one native API kind and a credential reference. Anthropic registrations also set a positive output-token limit. The HTTP boundary accepts system messages only as a leading group, so Anthropic and Gemini translation cannot silently reorder later system instructions. Adapters normalize one text assistant choice and provider token counts when available; absent usage remains unknown. A 429 or 5xx response carries a safe category and an upstream-response-started flag that blocks replay; a pre-response timeout carries a retry category. Authentication, validation, and malformed success responses also stop fallback. No provider error body or credential enters the returned failure.

## Audit and accounting

Record the plan and each attempt's route kind, model alias, upstream model, allowed provider set, selected or reported inference provider, policy version, outcome, and nonsecret credential ID. A delegated attempt also retains OpenRouter generation/request identifiers when available. Store estimated and upstream-reported cost separately. A later reconciliation may revise the reporting projection but must retain the original immutable attempt event.

For Jev-assisted selection, record its decision source (`jev` or deterministic fallback), chosen candidate ID, safe model identifier and confidence when valid, fallback reason when applicable, and Jev usage when available. Do not record its bearer key, response body, or prompt in ordinary audit events. Jev's own usage and cost must be attributed separately from the eventual inference provider's usage and cost.

The current managed invocation coordinator first applies model/provider IAM, then checks limits and resolves the Jev credential reference. It persists a nonsecret `selection-started` audit event before calling Jev, a `decision` event before direct inference, and an `attempt` outcome afterward. Any required pre-inference audit failure stops the call. If outcome auditing fails after the provider may have processed a request, the result marks `possiblyBilled: true` and does not automatically retry. Durable retry/alert handling and usage-ledger reconciliation remain integration work.

For provider fallback, each attempt event identifies its candidate and outcome; a failed attempt may include a safe failure category and possible-billing flag. The final selected candidate can differ from Jev's initial choice, and both facts must remain visible in audit and usage views.

## Remaining contract questions

- Exact default price-weighting or deterministic ranking formula and tie-breaking.
- Whether an OpenRouter internal retry counts as one or more local attempts; exact direct-adapter status mappings and per-attempt budget reservations.
- Metric freshness, health thresholds, and capability discovery.
- First supported request fields beyond text chat and whether streaming is required at launch.
- OpenRouter provider identity mapping across its endpoint slugs, BYOK routes, and the internal provider resource IDs.
