# Compose delegated text streams with route controls

## Issue and problem

- Issue: [#206](https://github.com/Theorvane/OpenGranter/issues/206).
- The internal OpenRouter text-stream invoker and client SSE encoder are separate from the delegated IAM, limit, usage and audit coordinator. A future HTTP route must not call the invoker directly and bypass those controls.

## Scope and expected behavior

- Add an internal composition that uses the existing delegated route coordinator. It delivers validated text deltas as awaited client SSE frames only after IAM, final-provider mapping, limits and required selection audit.
- The composition returns final usage and `[DONE]` frames only after the coordinator has handed off usage and recorded a successful attempt. Missing/invalid usage produces no fabricated usage frame.
- Denial, upstream failure, output callback failure or required usage/audit failure produces no terminal success frames. The existing coordinator records possibly billed attempts where applicable.
- Do not enable public `stream:true`, HTTP byte delivery, direct-provider streaming or client disconnection handling. No new policy action or audit event is introduced.

## Design

- Wrap `invokeDelegatedRoute` with an OpenRouter text-stream invocation port and an awaited delta-to-SSE callback. Retain only the last delta's metadata needed for the final usage frame; never buffer text.
- Validate that the trusted streaming port returned a complete outcome matching the delivered terminal delta before the coordinator accounts for success. The coordinator remains the source of authorization, provider scope, limit, usage and audit decisions.
- Return the final SSE frames as data for a later HTTP writer. That writer must handle post-accounting delivery failures and cancellation; this issue does not assume such failures can be converted to a JSON response.
- See [contract](../../contracts/delegated-text-stream.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility](../openrouter-compatibility.md). No ADR: the composition reuses the existing route contract.

## TDD plan

- First write a composition test showing authorized provider scope, ordered delta frames, accounting/audit before terminal frames, and expected missing-module failure.
- Add explicit model/provider deny, limit deny, upstream midstream failure, output callback rejection and usage/audit handoff failure tests. Confirm no terminal success frames on failure and safe metadata.
- Implement the smallest wrapper, refactor and run `npm run check`.

## Delivery

- Issue, plan and contract, red/green tests, full validation and a reviewable PR.
- Risk: partial deltas may reach the caller before an upstream/accounting failure. The later HTTP adapter must send a safe midstream error and reconcile interruption without replaying the attempt.
