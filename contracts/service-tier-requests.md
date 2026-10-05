# Bounded service-tier requests contract

Issue #454. Plan: [454-service-tier-requests](../docs/plans/454-service-tier-requests.md).

Both chat bases accept optional nullable service_tier on supported nonstream/text/refusal/function paths. Omission/null omit the prepared upstream field without a default. Capture exactly one primitive literal before route/credential awaits. Unknown strings, empty/case/whitespace variants, nonstrings and boxed strings reject safely before routes/credentials; no coercion or alias rewriting.

Managed OpenAI accepts auto/default/flex/scale/priority/fast, preserving the literal. Its ultrafast value rejects before secrets because it is outside the reviewed native Chat contract. Delegated OpenRouter accepts explicit default only; all other non-null recognized values reject before secrets. Anthropic/Gemini supplied tiers reject before secrets pending distinct native mappings; omission/null remain accepted. Preserve fixed approved model/host/provider.only and selected final-provider enforcement.

OpenRouter service_tier can opt separate tier endpoints into a base-slug pool. This subset does not authorize those additional endpoints. Explicit default disables model-variant tier admission according to the official guide, but precedence against administrator-configured tier-suffixed slugs is unverified; retain the existing approved slug set without rewriting it or claiming universal suppression.

Request selection does not manufacture a response tier. Preserve only metadata actually supplied by the upstream, including differing served values; absent response fields remain absent. Do not infer model eligibility, latency, SLA, discounts, billed prices or actual served tiers from request preferences. Existing aggregate accounting and estimate/billed distinctions remain shared; no tier values enter operational audit/usage/error records.

Authentication, fresh IAM/Deny, limits, registered hosts, required audit/usage before terminal delivery, safe missing usage and possibly-billed failure/cancellation remain shared. Session identifiers, user, keys, metadata, cache controls and tools retain their independent behavior.

Version 30 adds only the exact raw OpenRouter nullable enum and unknown-value extension for service_tier to 34 fields; all prior definitions remain selected. Runtime's recognized-literal/provider subsets do not narrow the source pin. Removal reproduces version 29; offline integrity, fixed-host fresh drift and structural/malformed/stale/rehashed map guards apply. Actual installed SDK sockets use captured mock upstreams. Expanded delegated endpoint authorization, native equivalents, full #116 and unresolved #7 remain open.

Sources: [OpenRouter schema](https://openrouter.ai/openapi.json), [tier routing](https://openrouter.ai/docs/guides/features/service-tiers), [provider matching](https://openrouter.ai/docs/guides/routing/provider-selection), [OpenAI Chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
