# Encode scoped OpenRouter text SSE output

## Issue and problem

- Issue: [#204](https://github.com/Theorvane/OpenGranter/issues/204).
- The internal stream decoder and consumer can validate OpenRouter text events, but no output contract turns those events into external-client SSE frames.

## Scope and expected behavior

- Encode decoded text deltas, a complete final usage event, and `[DONE]` as OpenRouter-shaped `data` frames. Use the already authorized client model alias, one choice at index zero, and exact supported finish reasons.
- Omit an incomplete or invalid usage frame rather than inventing token counts. The accounting layer retains the original usage marker and must surface its uncertainty. Never serialize upstream error events or their details.
- This is an internal serializer. Public `stream:true`, client transport, gateway IAM/limits, usage persistence, audit and direct-provider streams remain out of scope.
- No new permission, secret or audit behavior is introduced. The serializer receives events only after upstream scope validation; it cannot select a route or provider.

## Design

- A pure encoder maps a single normalized text event to one UTF-8 SSE data frame, no frame for incomplete usage, or a fixed error for unsupported events. JSON serialization escapes line breaks and client text within one frame. It projects only documented output fields.
- The final usage frame repeats the terminal finish reason when provided; the accepted empty-choice upstream variant is rendered as an empty-choice usage frame. Do not synthesize a finish reason.
- This component does not validate event order; the existing stream sequence validator remains the authoritative ordering gate. Client delivery must compose them before enabling the public route.
- See [contract](../../contracts/openrouter-client-sse.md), [compatibility](../openrouter-compatibility.md), and [acceptance](../acceptance.md). No ADR: this is a local, reversible serialization choice.

## TDD plan

- First write a test for role/content/terminal/usage/done frame shapes and observe missing-module failure.
- Test Unicode and embedded newlines, aliases, partial/invalid usage omission, empty-choice usage, safe rejection of error events and unrecognized input.
- Implement the smallest pure encoder; run focused tests and `npm run check`.

## Delivery

- Issue, plan/contract, red/green evidence, full check and a reviewable PR.
- Risk: emitting frames before final accounting may expose partial output on upstream failure. The later gateway integration must report possibly billed partial attempts without replay or exposing secret details.
