# Jev-Assisted Managed Routing

## Issue and problem

- Issue: [#7](https://github.com/Theorvane/OpenGranter/issues/7)
- Managed routes have only deterministic selection preferences. Administrators also need an optional Jev decision for choosing among registered direct destinations.
- The repository began this issue with candidate authorization and contract fixtures but no HTTP gateway, provider adapters, route store, or secret store. This issue now establishes tested decision, invocation, and HTTP boundaries; live inference still depends on concrete implementations of their ports.

## Scope and expected behavior

- In scope: an administrator-configured Jev selector for managed routes, a TypeScript TypeSafe Jev decision client, bounded candidate selection, an invocation coordinator with narrow limit/secret/audit/direct-adapter ports, a tested HTTP chat request boundary and Node server bridge for the current text-only non-streaming subset, decision/failure contracts, and updated architecture and audit requirements.
- This increment adds concrete direct OpenAI, Anthropic, and Gemini adapters for that same narrow text-only, non-streaming subset. Registrations and credential references are trusted administrator data; upstream hosts are fixed. Each adapter normalizes a successful response and classifies safe retry failures. No live credentials or persistence are introduced.
- Out of scope: changing delegated OpenRouter behavior, cross-kind fallback, arbitrary client-supplied destinations, and pretending Jev is the model inference provider.
- A request's eligible candidate list is fixed only after authentication, route resolution, IAM evaluation for the model and final inference providers, capability checks, and limit checks. Jev receives only eligible candidate IDs and approved descriptions. Its selected ID must match one of them exactly; the direct provider adapter then makes the inference call.
- Jev uses a separate server-held credential reference. No key or content may enter operational logs or ordinary audit events. The decision event records candidate IDs, selected ID, policy/route version, outcome, and any safe decision metadata. The later inference attempt remains a distinct record.
- On Jev decision failure or low confidence, use the first already eligible managed candidate in administrator order. Retry a direct-provider failure only if no upstream response has started and the adapter explicitly classifies the failure as retryable; try remaining previously authorized managed candidates once each. An HTTP 429 or 5xx response starts the upstream response and stops automatic replay, even when no bytes have reached the client. This narrows the previously confirmed fallback direction in response to PR #8 review, to avoid replaying a request that the provider may have processed. Prompt text is still sent only when an administrator enables it for the route; that disclosure default remains provisional.

## Design

- Preserve the existing `delegated` and `managed` route kinds. A managed route gains a selection strategy; Jev is a decision service, not a third inference route kind.
- Keep candidate authorization in `authorizeCandidates`; the Jev boundary consumes its result and cannot call unregistered provider URLs or replace candidate metadata.
- The invocation coordinator receives a trusted authenticated principal and a versioned administrator route snapshot. It filters IAM permissions before secret lookup, checks limits before Jev or inference calls, persists the nonsecret decision before direct invocation, and records the attempt outcome. An audit-write failure before invocation stops the call. Concrete token authentication and persistence remain separate issues; the direct adapters are available as an injectable implementation.
- The HTTP boundary authenticates a proxy token, validates the current minimal OpenAI-compatible text chat request, resolves a trusted managed route snapshot, and invokes the coordinator. It maps safe result categories to HTTP statuses without exposing upstream errors or secrets. Concrete token storage and route persistence remain separate issues; this boundary uses injected ports in tests.
- A direct adapter explicitly classifies a failure (`rate-limit`, `server-error`, `timeout`, or `other`) and reports whether an upstream response has started. An HTTP status response sets that flag; a pre-response timeout may still retry. Unclassified errors, authentication/validation/policy failures, and any failure after response start stop the chain. Each attempt has a separate audit event; a failed audit write stops further attempts. A retry can still incur upstream cost, so the result surfaces possible billing.
- Treat Jev input as a separate data disclosure. A normal content-audit setting does not by itself grant permission to transmit a prompt to Jev.
- Alternatives considered: OpenRouter-hosted Jev can choose inside an OpenRouter route but does not establish bounded direct-provider selection by OpenGranter; a standalone router service could be supported later behind the same decision interface. TypeSafe's direct Choice API is the provisional integration target.
- Update [the routing contract](../routing.md), [architecture](../architecture.md), [PRD](../PRD.md), [acceptance scenarios](../acceptance.md), and `CONTEXT.md` when the owner resolves the decision tree. Add an ADR only if a durable, surprising trade-off is established.

## Open decisions

1. Confirm that TypeSafe's direct Choice API, rather than a separately deployed router or OpenRouter-hosted Jev model, is intended.
2. The fallback order is confirmed, but PR #8 review narrowed the retry trigger to failures before any upstream response. The administrator supplies a 0–1 Jev confidence threshold; no default threshold has been chosen. Billing reconciliation remains an implementation dependency.
3. Confirm explicit administrator opt-in for prompt text. The current implementation accepts text only; other content types need a later contract.
4. Configure concrete proxy-token authentication, credential references, route persistence, durable audit/usage stores, and limit reservation when those components exist. The current handler and coordinator accept narrow infrastructure ports; their tests use fakes. Direct native adapters exist but still need live configuration and storage integration.
5. The first HTTP slice accepts only non-streaming text chat with `model` and `messages`; the wider OpenAI parameter set and release-level streaming decision remain open.
6. Direct adapter registrations require an Anthropic output-token limit. The adapter rejects unsupported message ordering and malformed upstream success responses rather than silently changing their meaning. Provider usage may be absent; it must not be reported as zero. Route-store validation, concrete credential storage, and durable usage accounting remain separate work.

## TDD plan

- First add a contract test that rejects a Jev-selected candidate missing from the authorized managed set. Confirm the expected failure before implementing selection validation.
- Cover one allowed choice, provider Deny, empty candidate list, duplicate or malformed IDs, timeout, malformed response, low confidence, prompt disclosure, and same-kind fallback under the resolved policies.
- Add coordinator tests with fake ports for success, denial, limit rejection, secret failure, audit-write failure, and direct-adapter failure. Verify call order and that unauthorized requests never reach Jev or the provider.
- Add a failing same-kind fallback test: a Jev-selected direct provider reports a classified pre-response failure, the next authorized candidate succeeds, and both attempts are audited. Cover HTTP 429/5xx responses that block replay, other nonretryable or post-response failures, exhausted candidates, audit failure between attempts, and no Jev re-query.
- For PR #8 review, first add a failing direct-adapter regression proving HTTP 429/5xx set `responseStarted`, then an integration regression proving the coordinator does not invoke another provider after either status.
- Add an HTTP-boundary test first for a proxy token using Jev and a direct adapter. Cover missing/invalid token, malformed or unsupported input, unknown/denied model, Jev and provider fallback, and safe error responses with request IDs. Execute the relevant gateway fixture cases against this boundary where applicable.
- Add a socket-level Node HTTP test that sends a real POST through the server bridge to the injected gateway ports; verify status, request ID, body, and no sensitive details in transport failures.
- Use a fake HTTP transport. Tests must verify the request sent to Jev, not just the result. No live key is required for CI.
- Add failing fake-transport tests for all three official direct API request shapes, normalized responses and usage, safe 429/5xx/timeout classifications, authentication failure, malformed success, and secret isolation. Run the red tests before adding adapters.
- Implement the smallest selector and decision client, refactor with tests green, then run `npm run check` and `git diff --check`.

## Delivery

- Keep the PR in draft while the Jev integration target and prompt-disclosure default remain open; record the confirmed fallback contract in this plan and the routing tests.
- Implement the decision, invocation, and minimal HTTP request boundaries in issue #7's branch, update the draft PR with red/green evidence, and link remaining concrete token/route/secret/audit/provider-adapter dependencies.
- Risk: A future gateway could bypass candidate filtering if it calls the Jev client directly. Route live requests through the tested coordinator, supply only trusted route snapshots, and add HTTP tests before claiming live routing support.
- Risk: A provider call may complete before an outcome audit write fails. The coordinator marks possible billing and does not replay the call; durable reconciliation and alerting remain necessary.
