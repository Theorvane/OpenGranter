# Propagate HTTP client disconnection

## Issue and problem

- Issue: [#208](https://github.com/Theorvane/OpenGranter/issues/208).
- The shared Node HTTP bridge progressively pipes Fetch response bodies but has no per-request cancellation signal. A streaming handler cannot detect a disconnected client while awaiting its first provider delta.

## Scope and expected behavior

- Supply a Request.signal that aborts on interrupted upload or premature response connection closure, including while the handler is pending.
- Preserve progressive delivery and pipeline backpressure. Downstream failure cancels the active response body. Normal response completion does not abort the request.
- Remove lifecycle listeners after handling and delivery finish. Do not attempt fallback writes on destroyed sockets or after headers have been sent.
- No chat streaming enablement, upstream cancellation wiring, new IAM action, usage projection or audit event. Existing controls remain in the chat coordinator.

## Design

- One AbortController per Node request. Listen to incoming aborted and outgoing close, using outgoing.writableFinished to distinguish completed delivery. Pass its signal to the Fetch Request and remove listeners in finally.
- Keep the existing pipeline rather than buffering response text or inventing a separate socket writer. Abort before response handoff cancels a returned unread body.
- See [contract](../../contracts/http-client-disconnection.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [PRD](../PRD.md) and [compatibility](../openrouter-compatibility.md).
- Open dependencies: upstream abort propagation, audited interruption, safe midstream SSE errors and post-accounting delivery failure remain subsequent streaming work. This transport boundary does not settle those product contracts. No domain term or ADR is needed.

## TDD plan

- First actual-socket regression disconnects while the handler awaits its response and expects Request.signal to abort; the current bridge fails that assertion.
- Cover incremental SSE before completion, disconnect during delivery and body cancellation, interrupted upload, normal completion without abort, and existing safe JSON fallback behavior.
- Make the smallest lifecycle change; run focused socket tests, format and npm run check.

## Delivery

- Record red/green evidence and full checks in the PR and link this plan.
- Risk: abort is cooperative; downstream code must observe the signal. An upstream call may still be billed and must not be replayed. This change alone provides no durable interruption audit or public streaming support.

## Verification evidence

- Red: the focused pending-handler disconnect test failed on the original bridge with `false !== true` for Request.signal.aborted.
- Green: six actual-socket regression cases cover pending/midstream disconnects, interrupted upload, progressive/normal delivery, listener cleanup and compatible safe fallback.
- `npm run check`: 974 passed, 1 optional external PostgreSQL test skipped; typecheck, lint, planning checks and pinned OpenRouter schema integrity passed. Existing unrelated lint warnings remain.
