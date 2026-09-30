# OpenRouter stream HTTP response contract

An internal caller supplies an HTTP `Response` from a previously authorized fixed OpenRouter endpoint, a fixed model scope, and an awaited text-delta callback. Status is checked before parsing or reading any body. Only HTTP 200 with `text/event-stream` (optional media type parameters) and a readable body is passed to the bounded, scoped text-stream consumer. A complete result includes normalized usage only after the terminal sequence and `[DONE]`.

HTTP 429 maps to `rate-limit`, HTTP 5xx to `server-error`, and all other non-200 statuses to `upstream`. Invalid success headers/body, an upstream SSE error, malformed or truncated stream, transport error, and callback failure map to `upstream`. Every failure is an `OpenRouterChatFailure` with `responseStarted: true` and `possiblyBilled: true`; messages and error objects contain no upstream response body, delta text, callback error or credentials. Unused bodies are cancelled best-effort without delaying the failure and never parsed as JSON.

This component does not send an upstream request, authorize a route, deliver HTTP client SSE, write audit/usage, or enable client `stream:true`.
