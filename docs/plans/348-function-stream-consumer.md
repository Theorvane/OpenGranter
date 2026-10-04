# Internal delegated function stream consumer

## Issue and problem

- Issue: #348, release gate #116. Fragment/sequence validators exist, but function
  streams need byte framing, awaited delivery, cancellation and external-failure
  cleanup before transport/client integration can safely use them.

## Scope and expected behavior

- Compose bounded SSE, function decoder and sequence for a pre-authorized source.
  Capture model scope before awaits; deliver validated deltas in order, including
  terminal delta, and await callbacks before pulling further events.
- Return frozen assembled calls/usage only after terminal/usage/DONE. Upstream errors
  return fixed possibly-billed failure; framing/payload/order/truncation/transport/
  delivery/cancellation failures throw the shared fixed possibly-billed error.
- Cancel/release reader on DONE/error/early failure; honor cancellation during a
  pending read or callback. Late callback rejections stay observed; callback code
  itself cannot be forcibly stopped. Reuse established parser cleanup semantics.
- Add explicit sequence discard to clear private calls and invalidate the instance
  on external failure. Response-bearing calls/deltas never become audit metadata.
- No credential, routing, HTTP/client SSE, usage/audit execution or public tool-stream
  expansion. Original text consumer/guards remain unchanged; #116 stays open.

## Design

- Separate function consumer reuses framing/wait helpers and immutable decoded
  events. Sequence validation precedes callback; EOF cannot stand in for DONE.
- Idempotent discard clears retained calls and prevents subsequent success. It is
  cleanup, not an upstream error event; consumer catch discards before fixed failure.
- Sensitive successful calls stay response data only. Scope is a trusted typed
  boundary; arbitrary accessor/Proxy certification is outside this increment.
- No domain/ADR decision or schema pin change. Update PRD, architecture, acceptance,
  compatibility and consumer contract. Transport/SSE/accounting remain later work.

## TDD plan

- Public consumer regression red: missing implementation before coding. Sequence
  discard regression red: missing method before production change.
- Fragmented Unicode/interleaved calls, no read after DONE/error, callback backpressure,
  immutable scope, malformed/oversized frames, truncation and safe transport errors.
- Invalid terminal is not delivered; synchronous/asynchronous callback failures
  cancel safely. Already-aborted/pending-read/pending-callback cancellation releases
  locks despite uncooperative cleanup; late rejections cannot revive success.
- Focused existing text/sequence/HTTP/SDK/security suites, format and npm run check.

## Delivery

- Issue/plan, red/green, full checks, exact-head AI approval, required CI, human merge.
- Partial deltas may precede later failure; future client integration must avoid
  replay and distinguish committed output from pre-response failure. Without an
  AbortSignal, parser cleanup awaits cancellation as the established contract does.
- Public transport/client SSE/accounting, transitive schema drift and #116 stay open.

## Verification evidence

- Consumer regression red: missing implementation before coding. Discard regression
  red: 10 passed, 1 expected missing-method failure before sequence change.
- Focused consumer/sequence/text/cancellation/HTTP green: 70 passed. Bytewise Unicode,
  backpressure, immutable scope, safe failure/terminal suppression, stalled reads/
  callbacks, late rejection and reader cleanup are covered.
- Full npm run check passed strict types/lint, 1,577 tests with one existing
  PostgreSQL skip, planning/contracts/fixture scan and offline pin integrity.
- Existing HTTP/tool-stream guards and IAM/limits/persistence/cancellation/accounting
  remain green. Evidence-only plan update passes the planning checker.
