# Bounded SSE data-event parser

## Issue and problem

- Issue: [#188](https://github.com/Theorvane/OpenGranter/issues/188).
- Streaming chat remains rejected. The gateway first needs a reusable frame reader that does not depend on transport chunk boundaries or leak upstream content through failures.
- OpenRouter sends keepalive comments, data events and a terminal marker; the SSE standard also permits multiline fields and several line endings.

## Scope and expected behavior

- Parse UTF-8 SSE data events from a `ReadableStream<Uint8Array>` on demand, with a configurable bounded line/event size and a safe fixed error.
- Support CR, LF and CRLF (including split CRLF), initial BOM, comments, ignored non-data fields, multiline data and blank-line dispatch. Discard incomplete final events.
- Cancel an unfinished source when its consumer stops. Do not retain a full stream or emit provider content in diagnostics.
- `stream:true` stays rejected. No route, permission, secret, usage or audit behavior changes in this issue.

## Design

- Use a strict streaming `TextDecoder`; incrementally scan characters and accumulate at most one bounded line and one bounded event. Preserve one leading space after `data:` except the single optional SSE separator space.
- Expose only an async iterable of data strings. Upstream chunk validation, `[DONE]`, usage and errors belong to later protocol layers, so this parser must not interpret JSON or endpoint-specific markers.
- Pull from the reader only when the consumer requests more output. Cancel and release the reader on early iteration termination or parsing failure.
- Limit bytes by UTF-8 length of each complete line and collected data event; reject oversized unfinished lines before further accumulation.
- See [stream framing contract](../../contracts/streaming-sse-framing.md), [compatibility inventory](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- First add public-boundary tests for chunk-split CRLF, comments and multiline data; confirm module import/test failure before implementation.
- Add strict UTF-8, oversized line/event, incomplete EOF, fixed error, backpressure and early-cancel cases.
- Implement the smallest bounded parser, run focused tests and `npm run check`.

## Delivery

- Issue and plan; red test; parser; contract and compatibility docs; green/full checks; PR.
- Risk: a framing parser alone does not make streaming safe to expose. Client streaming stays disabled until post-commit failure, cancellation, provider normalization, audit and accounting are integrated.
- PR evidence: red/green commands, full check result and remaining gates.
