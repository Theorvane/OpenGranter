# Validate OpenRouter stream HTTP responses

## Issue and problem

- Issue: [#198](https://github.com/Theorvane/OpenGranter/issues/198).
- The internal stream consumer accepts bytes, but no HTTP boundary rejects error statuses or non-SSE responses before parsing. A future provider invoker needs safe response classification without exposing upstream error bodies.

## Scope and expected behavior

- Add an internal boundary over an already fetched `Response`, fixed authorized model scope, and awaited text-delta callback.
- Accept HTTP 200 with `text/event-stream` and a readable body, then use the existing consumer. Preserve its complete usage summary.
- Classify HTTP 429, 5xx and other statuses through existing safe delegated failure categories. Convert invalid success headers/body, upstream SSE error, parsing/order errors, EOF and callback failures to a fixed possibly-billed upstream failure. Cancel unused bodies.
- Do not issue HTTP requests, enable client `stream:true`, persist audit/usage, or change non-streaming behavior.

## Design

- Use the existing `OpenRouterChatFailure` shape for safe failure category, response-started and possible-billing metadata. An HTTP response has started even when it contains no valid SSE event.
- Check status before media type or body. Never read a non-success body. Accept the media type with optional parameters; the existing SSE parser applies strict UTF-8 decoding.
- Pass a fixed scope into `consumeOpenRouterTextStream`. Treat its safe failed outcome as an upstream failure to prevent success accounting. Do not forward raw exceptions, content or credentials.
- No new domain term or irreversible decision is introduced. See [contract](../../contracts/openrouter-stream-response.md), [compatibility inventory](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- First test a valid HTTP SSE response with a final usage summary and capture the missing-module failure.
- Add status classification, content-type/body denial, first/midstream SSE error, malformed/truncated stream, callback error and unread-body cancellation cases.
- Implement the smallest response adapter and run focused tests, formatting and `npm run check`.

## Delivery

- Issue, plan/contract, red, implementation, green/full check, reviewable PR.
- Risk: provider-specific response headers or stream variants may need conformance additions. This does not start upstream HTTP, client output or accounting.
- PR evidence: red/green, full check, remaining integration work.
