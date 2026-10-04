# Upstream function stream HTTP response boundary

## Issue and problem

- Issue: #350, release gate #116. The function consumer validates byte streams,
  but request adapters need status/media/body validation and safe response failures.

## Scope and expected behavior

- Separate function Response boundary: only HTTP 200, text/event-stream with
  optional media parameters and a body reaches the scoped bounded consumer.
- 429 maps to rate-limit; 5xx to server-error; other non-200 or malformed success
  and consumer/upstream/callback/cancellation failures map to upstream. All use
  fixed OpenRouterChatFailure with responseStarted/possiblyBilled true, no cause.
- Unused bodies cancel best-effort without reading/JSON parsing or waiting on
  uncooperative cleanup. Completed calls/usage remain frozen response content.
- Awaited delivery and signal cancellation retain consumer behavior. No request,
  client HTTP/SSE, credentials, IAM or audit/usage execution is enabled. Original
  text response/guards stay unchanged; #116 remains open.

## Design

- Add a narrow function response module patterned after the established text
  response boundary, using the function payload/outcome types and consumer.
- Do not refactor the working text path or invent new error/timeout authority;
  request adapter timeout classification remains later work.
- Response content must never enter operational records. No domain/ADR/pin change.
  Update PRD, architecture, acceptance, compatibility and response contract.

## TDD plan

- Public regression red: missing function response implementation before coding.
- Valid SSE/Unicode/interleaved calls, usage and DONE with no trailing read.
- Non-200 status and bad media/body reject before reads; invalid/mismatched/truncated
  streams and sync/async callbacks fail safely with reader release.
- Stalled cleanup cannot delay HTTP failure; locked-body and cancellation remain
  safe. Existing text/consumer/HTTP/SDK/security tests stay green.
- Minimum implementation, focused tests, format and full npm run check.

## Delivery

- Issue/plan, red/green, full checks, exact-head AI approval, CI and human merge.
- Source is an already-authorized Response. No arbitrary host or route authority;
  request adapter/accounting/client SSE integration and full #116 remain open.

## Verification evidence

- Public regression red: missing implementation before coding.
- Focused function/text response/consumer/HTTP/cancellation green: 64 passes.
- Full npm run check: strict types/lint, 1,584 tests with one existing PostgreSQL
  skip, planning/contracts/fixture scan and offline pin integrity all pass.
- Status/media/body gates, exact Unicode calls/unknown usage, no error-body reads,
  safe stream/callback failures, uncooperative cleanup, stalled cancellation and
  locked-reader ownership are covered. Existing guards stay green. Evidence-only
  plan update passes the planning checker.
