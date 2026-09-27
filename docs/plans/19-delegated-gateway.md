# Delegated OpenRouter Gateway Invocation

## Issue and problem

- Issue: [#19](https://github.com/Theorvane/OpenGranter/issues/19)
- The authenticated chat gateway invokes only managed Jev routes. The bounded OpenRouter adapter is present but no delegated route can use it through the gateway's proxy-token, IAM, limit, and audit boundary.

## Scope and expected behavior

- In scope: a trusted delegated route variant for the existing text-only, non-streaming chat endpoint; final-provider IAM filtering; verified OpenRouter provider-slug resolution through an injected trusted port; limit check; attributed pre-call and outcome audit; one bounded upstream invocation; HTTP and socket tests.
- Out of scope: the concrete provider-ID/slug registration and verification workflow, durable stores, multi-model fallback, cross-kind fallback, price/health routing, streaming, and usage reconciliation.
- A route snapshot identifies one delegated route kind, version, upstream credential reference, and approved candidate pairs. The gateway selects the first IAM-eligible upstream model in administrator order and groups only eligible candidates for that model. Each grouped provider ID must resolve to a verified exact OpenRouter slug; missing, malformed, or ambiguous mappings fail closed. The bound adapter receives those slugs, one upstream model, the public alias request, and the route's credential reference through a narrow invocation port.
- The gateway audits selection before inference and outcome afterward using fixed principal, credential, policy-version, route-version, candidate, and request identifiers. Denials and mapping/limit failures produce safe errors and no inference call. A failed outcome audit blocks the response and does not replay a possibly billed call.

## Design

- Add a discriminated `DelegatedChatRoute` beside the existing managed route. Keep the managed route shape compatible and dispatch only a route explicitly marked `kind: 'delegated'` into the new coordinator.
- A trusted `resolveVerifiedProviderSlug(providerId, upstreamModelId)` port supplies a slug only after administration has verified that it does not reach beyond that internal inference-provider resource. The gateway rejects duplicate slugs representing different internal IDs because they make the authorization scope ambiguous. This port does not implement or settle the verification workflow.
- The coordinator uses the existing `authorizeCandidates` policy evaluator, checks limits, writes safe audit events, and calls `invokeOpenRouter(credentialRef, attempt, request)`. The existing adapter enforces the fixed host and request body. No raw key crosses the HTTP handler or audit port.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [routing](../routing.md), [acceptance](../acceptance.md), and [harness](../harness.md). Existing domain terms suffice; no ADR is needed for this bounded implementation seam.

## TDD plan

- First add an HTTP test for an allowed delegated alias with one denied provider and one allowed provider; expect the current handler to fail or reject the new route before implementation. Assert the exact verified slug set, order of limit/audit/inference calls, alias response, and no direct/Jev invocation.
- Add tests for authentication, model/provider Deny, empty candidates, missing/invalid/ambiguous mapping, mapping-store failure, limit denial, audit-write failures before and after inference, safe upstream failure, and managed-route regression. Add a socket-level delegated request.
- Implement the smallest coordinator and handler dispatch change. Run focused red/green tests, `npm run format`, `npm run check`, and `git diff --check`.

## Delivery

- Commit on `feat/19-delegated-gateway` with the contributor DCO and assistance trailers. Open a ready PR linked to #19 and this plan.
- Concrete route/catalog stores, verified mapping administration, secret storage, limits, audit persistence, and usage reconciliation remain necessary before deployment. A mapping port returning an unverified or broader slug would violate the intended IAM guarantee; deployments must fail closed until that port exists.
