# Bounded OpenRouter Chat Adapter

## Issue and problem

- Issue: [#17](https://github.com/Theorvane/OpenGranter/issues/17)
- OpenGranter has direct-provider chat adapters but no adapter for an authorized delegated route through OpenRouter. The product requires a server-held upstream credential and a request-specific final-provider bound.

## Scope and expected behavior

- In scope: one text-only, non-streaming OpenRouter chat attempt against the fixed official endpoint; a trusted model slug and nonempty already-authorized OpenRouter provider slug set; secret-reference resolution; server-generated `provider.only`; OpenAI-compatible response normalization; safe failure classification and tests.
- Out of scope: gateway delegated-route dispatch, internal-to-OpenRouter provider identity mapping and its verification workflow, provider capability discovery, multi-model fallback, account/workspace guardrail provisioning, and usage-ledger persistence.
- The adapter accepts only a trusted attempt from the route coordinator. It rejects empty, duplicate, or malformed provider slugs and malformed model slugs before resolving the upstream key or contacting OpenRouter. It sends one `model`, no `models` array, and `provider.only` containing exactly the supplied authorized slugs. No caller body, route override, upstream URL, or provider preference is forwarded.
- A successful response uses the public model alias and retains the OpenRouter generation ID and known token counts. Missing usage remains unknown. Safe errors contain no key, prompt, response body, or OpenRouter error text.

## Design

- Add `src/providers/openrouter-chat.ts` with a narrow secret and fetch port and a fixed `https://openrouter.ai/api/v1/chat/completions` destination. The route coordinator will later construct an attempt from its IAM-filtered candidate set and verified provider mapping; this issue does not expose the adapter directly to untrusted callers.
- Use `redirect: 'error'` and a timeout. Classify upstream HTTP failures as response-started and possibly billed; a pre-response timeout is possibly billed without an upstream response. Reject malformed success responses.
- [OpenRouter chat API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) documents the endpoint and OpenAI-compatible response. [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection) documents request-level provider bounds. [Guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview) documents intersection with account/workspace/key restrictions.
- Update [routing](../routing.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [harness](../harness.md) to identify the implemented adapter and its remaining integration boundary. No domain term or ADR changes are needed.

## TDD plan

- First test a successful bounded call through the public adapter factory; expect a missing-module failure before implementation. Check the fixed URL, secret-ref use, exact `provider.only`, normalized alias and usage, and no forwarded routing options.
- Add denial/configuration tests for empty or malformed provider set, missing key, and invalid model. Add failure tests for HTTP status, malformed success body, redirect/network error, and timeout; inspect safe error fields and billing flags.
- Implement the smallest adapter, run focused red/green tests, `npm run format`, `npm run check`, and `git diff --check`.

## Delivery

- Commit on `feat/17-bounded-openrouter-chat` with the contributor DCO and assistance trailers. Open a ready PR linked to #17 and this plan.
- This adapter alone is not a deployable delegated gateway. A later issue must enforce IAM, map internal provider IDs to verified OpenRouter slugs, check limits and write audit events before calling it.
