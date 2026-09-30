# Consume validated OpenRouter text streams

## Issue and problem

- Issue: [#196](https://github.com/Theorvane/OpenGranter/issues/196).
- The existing bounded SSE parser, chunk decoder and sequence validator have no real-stream composition boundary. Transport errors, callback backpressure and early reader cancellation have not been verified together.

## Scope and expected behavior

- Add an internal async consumer over an already opened upstream `ReadableStream<Uint8Array>`, a fixed authorized `StreamModelScope`, and an async delta callback.
- Validate each event before delivering its text delta. Return a complete normalized usage summary only after terminal, usage and `[DONE]`; return a safe failed outcome for an upstream SSE error.
- Convert malformed framing/chunks/order, truncated transport and callback failures to a fixed possibly-billed failure. Stop and cancel the reader after terminal `[DONE]` or upstream error.
- Do not add provider HTTP invocation, client `stream:true`, direct-provider mapping, IAM/limits checks, or audit/usage persistence. Existing gateway behavior remains unchanged.

## Design

- Compose `parseSseDataEvents`, `decodeOpenRouterStreamPayload` and `OpenRouterTextStreamSequence` in one async function. The parser's fixed default event bound and reader ownership apply.
- Await each delta callback before pulling the next framed event. The caller owns delivery and must handle a possible later stream failure; this component does not claim that delivered deltas form a successful completion.
- Break on `[DONE]` or upstream error so the parser cancels the remaining reader. Expose no raw error as a cause or message.
- No new domain term or costly architectural decision is introduced. See [contract](../../contracts/openrouter-stream-consumer.md), [compatibility inventory](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- First test a fragmented SSE source with ordered callback delivery and final usage, then capture the missing-module red result.
- Add asynchronous backpressure, error-first/midstream, invalid payload/order, incomplete EOF, callback failure, reader cancellation and no-content-leak cases.
- Implement the smallest composition layer. Run focused tests, format, and `npm run check`.

## Delivery

- Issue, plan and contract; red test; implementation; green/full checks; ready PR.
- Risk: the caller may have sent partial text before a later stream failure. HTTP integration must provide a safe post-commit failure event and possibly-billed accounting.
- PR evidence: red/green outputs, full check and remaining integration work.
