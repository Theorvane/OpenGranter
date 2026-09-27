# Jev-Assisted Managed Routing

## Issue and problem

- Issue: [#7](https://github.com/Theorvane/OpenGranter/issues/7)
- Managed routes have only deterministic selection preferences. Administrators also need an optional Jev decision for choosing among registered direct destinations.
- The current repository has candidate authorization and contract fixtures, but no HTTP gateway, provider adapters, route store, or secret store. This issue establishes tested decision and invocation boundaries; a live end-to-end proxy still depends on concrete implementations of those ports.

## Scope and expected behavior

- In scope: an administrator-configured Jev selector for managed routes, a TypeScript TypeSafe Jev decision client, bounded candidate selection, an invocation coordinator with narrow limit/secret/audit/direct-adapter ports, decision/failure contracts, and updated architecture and audit requirements.
- Out of scope: changing delegated OpenRouter behavior, cross-kind fallback, arbitrary client-supplied destinations, and pretending Jev is the model inference provider.
- A request's eligible candidate list is fixed only after authentication, route resolution, IAM evaluation for the model and final inference providers, capability checks, and limit checks. Jev receives only eligible candidate IDs and approved descriptions. Its selected ID must match one of them exactly; the direct provider adapter then makes the inference call.
- Jev uses a separate server-held credential reference. No key or content may enter operational logs or ordinary audit events. The decision event records candidate IDs, selected ID, policy/route version, outcome, and any safe decision metadata. The later inference attempt remains a distinct record.
- On Jev decision failure or low confidence, use the first already eligible managed candidate in administrator order. On a retryable direct-provider failure before client response bytes are sent, try the remaining previously authorized managed candidates once each in administrator order. The user confirmed this fallback direction. Prompt text is still sent only when an administrator enables it for the route; that disclosure default remains provisional.

## Design

- Preserve the existing `delegated` and `managed` route kinds. A managed route gains a selection strategy; Jev is a decision service, not a third inference route kind.
- Keep candidate authorization in `authorizeCandidates`; the Jev boundary consumes its result and cannot call unregistered provider URLs or replace candidate metadata.
- The invocation coordinator receives a trusted authenticated principal and a versioned administrator route snapshot. It filters IAM permissions before secret lookup, checks limits before Jev or inference calls, persists the nonsecret decision before direct invocation, and records the attempt outcome. An audit-write failure before invocation stops the call. HTTP authentication, persistence, and native provider adapters remain separate issues.
- A direct adapter explicitly classifies a failure as retryable (`rate-limit`, `server-error`, or `timeout`) and reports whether client response bytes have started. Unclassified errors, authentication/validation/policy failures, and any failure after response start stop the chain. Each attempt has a separate audit event; a failed audit write stops further attempts. A retry can still incur upstream cost, so the result surfaces possible billing.
- Treat Jev input as a separate data disclosure. A normal content-audit setting does not by itself grant permission to transmit a prompt to Jev.
- Alternatives considered: OpenRouter-hosted Jev can choose inside an OpenRouter route but does not establish bounded direct-provider selection by OpenGranter; a standalone router service could be supported later behind the same decision interface. TypeSafe's direct Choice API is the provisional integration target.
- Update [the routing contract](../routing.md), [architecture](../architecture.md), [PRD](../PRD.md), [acceptance scenarios](../acceptance.md), and `CONTEXT.md` when the owner resolves the decision tree. Add an ADR only if a durable, surprising trade-off is established.

## Open decisions

1. Confirm that TypeSafe's direct Choice API, rather than a separately deployed router or OpenRouter-hosted Jev model, is intended.
2. The fallback direction is confirmed. The administrator supplies a 0–1 Jev confidence threshold; no default threshold has been chosen. Concrete adapter error classification and billing reconciliation remain implementation dependencies.
3. Confirm explicit administrator opt-in for prompt text. The current implementation accepts text only; other content types need a later contract.
4. Configure credential references, route persistence, HTTP gateway authentication, native provider adapters, durable audit/usage stores, and limit reservation when those components exist. The current coordinator accepts a credential reference and narrow infrastructure ports; its tests use fakes.

## TDD plan

- First add a contract test that rejects a Jev-selected candidate missing from the authorized managed set. Confirm the expected failure before implementing selection validation.
- Cover one allowed choice, provider Deny, empty candidate list, duplicate or malformed IDs, timeout, malformed response, low confidence, prompt disclosure, and same-kind fallback under the resolved policies.
- Add coordinator tests with fake ports for success, denial, limit rejection, secret failure, audit-write failure, and direct-adapter failure. Verify call order and that unauthorized requests never reach Jev or the provider.
- Add a failing same-kind fallback test: a Jev-selected direct provider reports a pre-response 429, the next authorized candidate succeeds, and both attempts are audited. Cover nonretryable errors, post-response failures, exhausted candidates, audit failure between attempts, and no Jev re-query.
- Use a fake HTTP transport. Tests must verify the request sent to Jev, not just the result. No live key is required for CI.
- Implement the smallest selector and decision client, refactor with tests green, then run `npm run check` and `git diff --check`.

## Delivery

- Complete the open product decisions, then amend this plan and contracts before production code.
- Implement the decision and invocation boundaries in issue #7's branch, update the draft PR with red/green evidence, and link remaining HTTP gateway/native-adapter dependencies.
- Risk: A future gateway could bypass candidate filtering if it calls the Jev client directly. Route live requests through the tested coordinator, supply only trusted route snapshots, and add HTTP tests before claiming live routing support.
- Risk: A provider call may complete before an outcome audit write fails. The coordinator marks possible billing and does not replay the call; durable reconciliation and alerting remain necessary.
