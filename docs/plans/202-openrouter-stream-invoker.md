# Invoke authorized OpenRouter text streams

## Issue and problem

- Issue: [#202](https://github.com/Theorvane/OpenGranter/issues/202).
- The upstream SSE layers validate an already fetched response, but no internal invoker sends `stream:true` to the fixed OpenRouter endpoint. Duplicating request preparation would risk different authorization and parameter behavior from the existing non-streaming path.

## Scope and expected behavior

- Add an internal text-only streaming invoker using the fixed OpenRouter chat endpoint, server-held credential, captured IAM-approved model and final-provider slugs, shared request controls, redirect rejection and bounded timeout.
- Deliver only validated deltas through an awaited callback; return normalized final usage only after terminal/usage/`[DONE]`. Reject function-tool controls before secret resolution because the current text stream decoder cannot represent tool deltas.
- Preserve safe pre-header HTTP/transport and post-header SSE failures with possible-billing metadata. Do not retry or broaden fallback.
- Do not expose client `stream:true`, persist audit/usage, change route orchestration or add direct-provider streaming.

## Design

- Extract the current delegated request validation/snapshot and HTTP preparation into shared internal helpers. Both invocation modes use one captured model/provider attempt and identical supported text/sampling fields; only the stream flag and tool-control support differ.
- The stream invoker calls `consumeOpenRouterTextResponse` with the fixed upstream model and captured client alias. A timeout remains active through body consumption; after headers, timeout is a possibly-billed response-started failure.
- The adapter is a trusted port called only after gateway authentication, route eligibility, model/final-provider IAM, limits and required audit. No new domain term or ADR is needed.
- See [contract](../../contracts/openrouter-stream-invoker.md), [architecture](../architecture.md), [compatibility](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- First add an internal invoker test for a fixed-endpoint `stream:true` request with exact `provider.only`, validated SSE delta delivery and final usage; capture missing-module red.
- Add invalid scope/control/credential denial before HTTP, mutation during secret await, status/network/redirect/timeout and midstream failure cases. Preserve non-streaming regression suite.
- Implement the smallest shared request preparation and streaming invoker; format and run `npm run check`.

## Delivery

- Issue/plan/contract, red, implementation, green/full checks, reviewable PR.
- Risk: client HTTP streaming, accounting and direct-provider mappings remain separate gates; partial callbacks must not trigger request replay.
- PR evidence: red/green, full check, unchanged non-streaming cases and remaining integration risks.
