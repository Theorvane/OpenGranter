# Upstream function stream HTTP response boundary

consumeOpenRouterFunctionResponse accepts an HTTP Response obtained from an
already-authorized upstream and a trusted model scope. Status is checked before
any body read: only 200 with text/event-stream (case-insensitive, optional media
parameters) and a body reaches the bounded function consumer. Success returns
frozen completed response calls and final usage only after terminal/usage/DONE.

429 maps to rate-limit; 5xx to server-error; every other non-200 status maps to
upstream. Bad success media/body, locked unreadable body, upstream SSE errors,
malformed/mismatched/incomplete sequences, callback/transport and cancellation
failures map to upstream. All failures are fixed OpenRouterChatFailure with
responseStarted:true and possiblyBilled:true, no cause or upstream/callback/caller
content. Error bodies are never read or parsed as JSON.

Unused bodies cancel best-effort without awaiting cleanup or letting synchronous/
asynchronous cancellation errors hide the safe failure. Consumer-owned readers
release normally, including stalled reads with AbortSignal and uncooperative
cleanup. Already locked readers remain their original caller's responsibility.
Completed calls/deltas are response-bearing content and must stay out of operational
audit/usage/errors; missing usage remains unknown rather than invented.

This internal boundary does not issue requests, authorize routes, resolve secrets,
persist audit/usage or send client SSE. Original text response, request/HTTP tool
stream guards and shared IAM/limits/persistence/accounting remain unchanged.
Request adapter, accounting/client SSE integration, transitive schema drift and
full #116 workflows remain open. See [plan](../docs/plans/350-function-stream-response.md)
and [consumer](function-stream-consumer.md).
