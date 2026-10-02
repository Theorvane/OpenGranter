# Delegated OpenRouter text-stream composition

This is an internal boundary for an authenticated principal, an approved delegated route and a validated text-only chat request. It evaluates model and final-provider IAM through the existing delegated route coordinator, resolves verified provider slugs, checks the limit and writes the selection audit before invoking the one scoped OpenRouter text stream.

Each validated delta is serialized to one client-model-alias SSE frame and passed to an awaited output callback. The composition retains only response id, model, creation time and terminal finish reason needed for final framing. It rejects a trusted invocation result that does not match a delivered terminal delta. It does not buffer prompt or response text.

The existing delegated coordinator writes one attempt usage record and outcome audit before reporting success. Only then may the composition return a complete usage frame, when all required usage counters are valid, followed by `[DONE]`. It returns these final frames to the future HTTP writer; it does not send them itself. Missing or invalid usage remains marked in the ledger and yields only `[DONE]` as the terminal frame set.

Denials and failures return the coordinator's fixed result and no terminal success frames. Upstream response-started and output callback failures are possibly billed and receive the existing failed-attempt accounting/audit path. A required accounting or audit failure cannot produce a successful terminal frame. The public chat handler still rejects `stream:true`; HTTP delivery, post-accounting write failure, client cancellation and direct-provider streams remain separate gates.
