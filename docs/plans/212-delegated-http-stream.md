# Deliver controlled delegated HTTP text streams

## Issue and problem

- Issue: [#212](https://github.com/Theorvane/OpenGranter/issues/212).
- The internal scoped stream coordinator, upstream cancellation and socket bridge are separate. Public stream:true still fails validation and external-client streaming workflows cannot run.

## Scope and expected behavior

- Enable text-only delegated stream:true on both chat bases when a trusted streaming invocation port is configured. Authentication, model/final-provider IAM, verified mapping, limits, selection audit and attempt usage/outcome audit remain mandatory.
- Reject managed streams, streaming tool declarations/choices/history and unsupported stream_options before inference. Existing supported text/sampling controls, including text/json_object format, keep their mappings; text deltas are not local JSON validation. Non-streaming behavior remains unchanged.
- Before the first validated delta, return existing safe JSON errors. Afterwards send the same fixed path-specific envelope in one SSE data frame and close without DONE.
- Hold at most one pending frame, await body pulls, propagate request abort/body cancellation and remove listeners. Send complete final usage when available and DONE only after required usage and success audit.
- Record separate metadata-only stream-interrupted events on cancellation/failure, with outcome and upstreamCompleted flag. An already accounted success is never overwritten or duplicated. HTTP body consumption does not establish physical network acknowledgment.

## Design

- Add a Fetch Response adapter around invokeDelegatedTextStream with a zero-high-water-mark ReadableStream and a single awaited frame handoff. Resolve the handler response at first validated delta or a no-frame coordinator result.
- Use a local AbortController plus request signal; body cancellation rejects the pending writer and signals the upstream. No prompt/response buffers beyond the current pending frame.
- The optional streaming port receives a per-call signal. Wire it through the generic and persisted dual gateway using the existing fixed-host invoker. Unsupported requests use current invalid-request audit; route results reuse current status/code mapping.
- Project stream-interrupted through the current PostgreSQL audit allowlist with authenticated attribution, model alias, route version, outcome failed/cancelled and upstreamCompleted boolean. Required interruption audit failure yields audit_unavailable when delivery is still possible. Cancellation audit is awaited as part of completion but cannot restore a closed client connection.
- See [contract](../../contracts/delegated-http-stream.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md).
- Dependencies: #210 / PR #211 supplies upstream cancellation. Direct-provider/tool streams, richer metadata, stream_options, durable recovery after ambiguous writes and physical delivery acknowledgment remain open. No new IAM action or costly trade-off requires an ADR.

## TDD plan

- First add a both-prefix HTTP test for stream:true through a trusted port; current code returns 400 instead of 200 SSE.
- Cover model/provider/limit/auth denial; pre-frame errors; progressive bounded output; upstream/usage/audit failures after frames; request/body cancellation; final delivery loss with one successful usage record; sanitized audit persistence.
- Add real OpenAI SDK socket streaming with faked provider and persisted dual composition tests. Keep non-streaming suites unchanged.
- Implement smallest response handoff and handler composition, format and run npm run check.

## Delivery

- Issue, English plan/contract, red/green evidence, full checks and reviewable PR. Integrate after prerequisite approval/CI; do not bypass review.
- Risks: validated partial text can arrive before a later failure; missing usage remains unknown, final usage is suppressed instead of fabricated, and stream consumers must handle safe errors. Body pulls do not guarantee socket receipt. Full compatibility remains incomplete.

The upstreamCompleted interruption flag identifies a validated complete upstream sequence even when its later usage or audit handoff fails. It is captured at the coordinator's successful-attempt usage handoff, separately from final client delivery and durable accounting success.

## Verification evidence

- Red: the first both-prefix HTTP stream test returned 400 instead of expected 200 SSE against the original handler.
- Additional red regressions: cancelling a pending error frame recorded two interruptions instead of one; usage/audit handoff failure incorrectly marked completed upstream inference as incomplete. Both now pass.
- Green: twelve HTTP/SDK tests cover both bases, pre-frame denial, midstream upstream/usage/audit failure, bounded handoff, client/body cancellation, post-accounting delivery loss, safe errors and missing usage. Persisted dual-route socket tests verify both bases, IAM-bound provider scope, ledger outcomes and sanitized interruption metadata.
- npm run check on merged #211 main: 1000 passed, one optional external PostgreSQL test skipped; typecheck, lint, planning checks and pinned schema integrity passed. Existing unrelated lint warnings remain.
