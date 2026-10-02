# Cancel scoped OpenRouter text stream attempts

## Issue and problem

- Issue: [#210](https://github.com/Theorvane/OpenGranter/issues/210).
- The internal delegated text invoker and bounded reader do not observe per-call client cancellation. A stalled upstream response can remain pending after the client disappears.

## Scope and expected behavior

- Accept an optional per-invocation AbortSignal. Check before credentials and after their await; combine it with the captured attempt timeout for fetch and SSE consumption.
- Pre-HTTP cancellation uses a safe upstream failure with responseStarted=false and possiblyBilled=false. After fetch starts, cancellation is possibly billed; after headers, responseStarted=true. Timeout retains its existing category. No caller cancellation reason is retained.
- Cancel a stalled body reader, stop buffered delta delivery after cancellation, remove abort listeners and release the reader lock. Stop awaiting a blocked output callback on abort and observe late settlement; callback implementations must observe cancellation to stop their own work.
- No retry, widened model/provider scope, public stream:true, direct-provider stream, new audit event or HTTP error envelope. Existing route failure accounting handles cancelled potentially billed attempts.

## Design

- Keep cancellation as an optional argument on the stream invocation and shared transport, without changing existing non-streaming invoker defaults. Capture the signal before credential awaits; use AbortSignal.any with the attempt timeout.
- Pass the combined signal through the response validator and stream consumer into the bounded SSE parser. The parser's abort listener cancels its owned reader and rejects with its existing safe invalid-stream error, never the external reason. Check signal state before reading and yielding each buffered event.
- Observe pending secret, fetch and callback promises together with abort, retaining rejection handlers after cancellation. Cancel a late fetch response body without retry. The fetch signal requests actual network cancellation; a port ignoring it may finish later.
- Cleanup remains owned by the reader. Signal-aware invocation cancels without waiting for an uncooperative source acknowledgment, including after a validated completed sequence.
- See [contract](../../contracts/openrouter-stream-cancellation.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md).
- Open dependencies: HTTP signal wiring, interruption auditing, midstream errors and post-accounting delivery failure remain follow-ups. No new domain term or costly design choice needs an ADR.

## TDD plan

- First test an already cancelled invocation: expect no secret or HTTP work and a safe non-billable failure. The existing invoker instead succeeds.
- Cover cancellation during credential resolution and pending fetch, a stalled body, buffered frames, normal completion, existing timeout behavior, safe errors, reader cleanup and delegated failed-attempt accounting with no terminal success or retry.
- Implement the minimum signal propagation, format and run focused tests and npm run check.

## Delivery

- Record issue, plan and contract before production edits; include red/green evidence and full checks in a PR.
- Cancellation after network dispatch cannot certify no provider charge. No usage counts are invented and inference is never replayed. This remains an internal capability until the client streaming boundary is implemented.

## Verification evidence

- Red: the already-aborted invocation regression failed with `Missing expected rejection` on the original invoker. A completed SSE source with unbounded cancellation acknowledgment also reproduced a pending invocation before cleanup was changed.
- Green: twelve new invocation/accounting cases pass, covering early and dispatched cancellation, uncooperative fetch/source/callback, timeout, normal completion, listener cleanup, safe metadata and no replay. Existing invoker and SSE parser cases pass.
- On main including merged #209, npm run check passed: 986 tests passed, one optional external PostgreSQL test skipped; typecheck, lint, planning/contract checks and pinned OpenRouter schema integrity passed. Existing unrelated lint warnings remain.
