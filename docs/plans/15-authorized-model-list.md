# Authorized Model Alias Listing

## Issue and problem

- Issue: [#15](https://github.com/Theorvane/OpenGranter/issues/15)
- The product contract promises `GET /v1/models`, but the current gateway only handles text chat. A caller cannot discover which administrator-published aliases its proxy token can use.

## Scope and expected behavior

- In scope: an OpenAI-compatible model-list response for enabled published aliases, reuse of proxy-token authentication and audit attribution, IAM filtering by model alias and final inference provider, safe catalog failure handling, and HTTP/socket tests.
- Out of scope: a concrete catalog database, provider capability or health discovery, pagination, provider-native model metadata, management APIs, or new routing preferences.
- A trusted catalog port supplies aliases, publication timestamps, and versioned route candidates. One alias appears once if at least one candidate in any approved route kind is allowed by the authenticated principal. The response is `{object:"list",data:[{id,object:"model",created,owned_by:"opengranter"}]}`. No upstream model ID, provider ID, credential, or denied alias appears.
- Authentication failures remain anonymous audit events. Catalog failures and successful listings carry the authenticated principal, credential, and policy versions. A required audit write failure blocks the response.

## Design

- Extend the existing gateway handler with `GET /v1/models` so the path shares authentication and attribution behavior with chat.
- Use `authorizeCandidates` for every catalog route; its model and final-provider IAM decisions are identical to the invocation path. The catalog port must return only administrator-published enabled routes and trusted creation times; the handler still rejects malformed or duplicate aliases rather than returning a misleading partial list.
- Keep the chat route resolver unchanged. Listing does not call Jev, limits, secrets, or providers.
- [OpenAI's model list shape](https://platform.openai.com/docs/api-reference/models/list) defines `object`, `data`, and model fields. OpenGranter uses alias IDs and its own owner value.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [routing contract](../routing.md), [acceptance scenarios](../acceptance.md), and [harness](../harness.md). No glossary or ADR change is needed.

## TDD plan

- First add an HTTP test showing only aliases with at least one IAM-allowed final provider, across managed and delegated routes. Confirm the current handler returns 404.
- Add tests for missing token, inactive principal, catalog failure, duplicate or malformed records, audit-write failure, and no external model calls. Add a socket-level GET test through the Node bridge.
- Make the smallest handler and port change; refactor shared authentication only if required by the tests. Run focused red/green tests, `npm run check`, and `git diff --check`.

## Delivery

- Commit on `feat/15-authorized-model-list` with the contributor DCO and assistance trailers. Open a ready PR linked to #15 and this plan.
- The listing is only as fresh and complete as the trusted catalog snapshot. Concrete persistence, health/capability filtering, and deployment wiring remain later work.
