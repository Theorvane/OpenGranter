# Jev-Assisted Managed Routing

## Issue and problem

- Issue: [#7](https://github.com/Theorvane/OpenGranter/issues/7)
- Managed routes have only deterministic selection preferences. Administrators also need an optional Jev decision for choosing among registered direct destinations.
- The current repository has candidate authorization and contract fixtures, but no HTTP gateway, provider adapters, route store, or secret store. This issue can establish a tested decision boundary; a live end-to-end proxy still depends on those components.

## Scope and expected behavior

- In scope: an administrator-configured Jev selector for managed routes, a TypeScript Jev decision client once its exact API is confirmed, bounded candidate selection, decision/failure contracts, and updated architecture and audit requirements.
- Out of scope: changing delegated OpenRouter behavior, cross-kind fallback, arbitrary client-supplied destinations, and pretending Jev is the model inference provider.
- A request's eligible candidate list is fixed only after authentication, route resolution, IAM evaluation for the model and final inference providers, capability checks, and limit checks. Jev receives only eligible candidate IDs and approved descriptions. Its selected ID must match one of them exactly; the direct provider adapter then makes the inference call.
- Jev uses a separate server-held credential reference. No key or content may enter operational logs or ordinary audit events. The decision event records candidate IDs, selected ID, policy/route version, outcome, and any safe decision metadata. The later inference attempt remains a distinct record.
- Fallback is confined to the already authorized managed candidate set. Behavior on decision failure, low confidence, and prompt disclosure is pending product-owner choices.

## Design

- Preserve the existing `delegated` and `managed` route kinds. A managed route gains a selection strategy; Jev is a decision service, not a third inference route kind.
- Keep candidate authorization in `authorizeCandidates`; the Jev boundary consumes its result and cannot call unregistered provider URLs or replace candidate metadata.
- Treat Jev input as a separate data disclosure. A normal content-audit setting does not by itself grant permission to transmit a prompt to Jev.
- Alternatives considered: OpenRouter-hosted Jev can choose inside an OpenRouter route but does not establish bounded direct-provider selection by OpenGranter; a standalone router service could be supported later behind the same decision interface. The exact Jev integration target remains open.
- Update [the routing contract](../routing.md), [architecture](../architecture.md), [PRD](../PRD.md), [acceptance scenarios](../acceptance.md), and `CONTEXT.md` when the owner resolves the decision tree. Add an ADR only if a durable, surprising trade-off is established.

## Open decisions

1. Which Jev product/API is intended: TypeSafe's decision API, a separately deployed router, or OpenRouter's hosted Jev model?
2. On timeout, malformed choice, and low confidence: deterministic authorized fallback or request failure? What confidence threshold is configured?
3. May Jev receive prompt text, only bounded metadata, or an administrator-controlled subset? What content types are supported?
4. Exact candidate description schema, credential configuration, timeout, and audit fields after the chosen API is confirmed.

## TDD plan

- First add a contract test that rejects a Jev-selected candidate missing from the authorized managed set. Confirm the expected failure before implementing selection validation.
- Cover one allowed choice, provider Deny, empty candidate list, duplicate or malformed IDs, timeout, malformed response, low confidence, prompt disclosure, and same-kind fallback under the resolved policies.
- Use a fake HTTP transport. Tests must verify the request sent to Jev, not just the result. No live key is required for CI.
- Implement the smallest selector and decision client, refactor with tests green, then run `npm run check` and `git diff --check`.

## Delivery

- Complete the open product decisions, then amend this plan and contracts before production code.
- Implement the decision boundary in issue #7's branch, publish a PR with red/green evidence, and link remaining gateway/adapter dependencies.
- Risk: A future gateway could bypass candidate filtering if it calls the Jev client directly. Keep orchestration at one public boundary and test that boundary before claiming live routing support.
