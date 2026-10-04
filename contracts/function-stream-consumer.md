# Internal delegated function stream consumer

consumeOpenRouterFunctionStream accepts a byte stream opened by an authorized
caller, a trusted typed model scope and an asynchronous callback. It captures the
scope before awaits, composes bounded SSE framing/function decoding/sequence
assembly, validates each event before delivery and awaits each delta callback
before reading more events. The terminal delta is delivered only after complete
call/finish validation. Success returns frozen response calls and final usage after
terminal/usage/DONE; EOF cannot replace DONE.

First-event or midstream upstream errors return the fixed failed possibly-billed
outcome. Framing, payload, model, order, truncation, transport, callback and
cancellation failures discard private assembly and throw the shared fixed
OpenRouterStreamSequenceFailure with possiblyBilled:true and no cause/payload.
The idempotent sequence discard clears calls and permanently prevents success.
Already delivered partial fragments are not replayed or retracted.

DONE/error/early failure cancels the source and releases its reader; completed EOF
only needs release. An AbortSignal interrupts pending reads/callback waits without
retaining the caller reason. Late callback rejections remain observed; callback
code itself cannot be forcibly stopped. Signal-aware cleanup does not wait for an
uncooperative cancel promise. Without a signal, established parser cancellation
cleanup is awaited. No remote EOF wait follows a terminal marker.

Callbacks and assembled success calls are response-bearing data, never operational
audit/usage/error metadata. This internal consumer does not open transport, resolve
credentials, authorize routes, send client SSE, persist usage/audit or enable public
tool streams. Original text consumer, HTTP/provider guards and shared IAM/limits/
persistence/accounting/privacy execution remain unchanged. Transport, accounting,
client SSE/cancellation integration, transitive schema drift and full #116 workflows
remain open. See [plan](../docs/plans/348-function-stream-consumer.md),
[sequence](function-stream-sequence.md) and [fragments](function-stream-chunks.md).
