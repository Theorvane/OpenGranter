# Delegated OpenRouter attempt scope snapshot

The delegated OpenRouter adapter receives a previously authorized upstream model ID and exact final-provider slug set. Before credential resolution or other asynchronous work, it copies and validates those values, then uses only that immutable snapshot in the upstream request and response model check. A later mutation of the source attempt, including array element changes or replacement, cannot widen or alter the destination.

An invalid initial scope fails as configuration before secret or HTTP access. The snapshot does not grant authority; the gateway must still authenticate, resolve eligible candidates, evaluate the model and final-provider policy, check limits and audit decisions before invoking the adapter. The [delegated streaming invoker](openrouter-stream-invoker.md) reuses this boundary, and the [HTTP composition](delegated-http-stream.md) exposes the supported text-stream subset through shared controls.
