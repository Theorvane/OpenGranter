# Gateway Per-Attempt Usage Capture

## Issue and problem

- Issue: [#23](https://github.com/Theorvane/OpenGranter/issues/23)
- The normalized usage record from #21 is not emitted by either route coordinator. Successful and possibly billed failed attempts therefore have no accounting handoff.

## Scope and expected behavior

- In scope: create one normalized record after each attempted managed or delegated upstream call, including managed fallback attempts. Pass it to an injected idempotent ledger handoff before returning or trying another candidate.
- Out of scope: concrete durable database/queue, price calculation, upstream bill reconciliation, usage query API, and content audit.
- Use request ID plus route kind and attempt ordinal as a stable attempt ID. Preserve selected candidate and its provider for direct attempts. For a delegated attempt, leave the actual provider unknown. Leave the selected candidate unknown too when several authorized candidates share one OpenRouter call; the response does not identify which one served it.
- Copy only normalized token counts from successful responses. Failed attempts that may have reached an upstream have missing usage and explicit possible billing. A known preflight configuration or credential failure creates no usage record. A later attempt has `possibleDuplicate` when an earlier attempt may have been billed.
- The handoff port must durably append or queue by attempt ID. A failed handoff stops fallback, writes a nonsecret failure audit event where available, returns a safe accounting error, and never replays inference. No record is produced for denials before an upstream call.

## Design

- Add a narrow `writeUsage` port to both route coordinators and the gateway. A clock port supplies deterministic timestamps and latency. The gateway refuses a chat request when accounting is unconfigured; model listing is unaffected.
- Construct records with `buildUsageRecord`, passing only attribution and an allowlisted `usage` field from the normalized provider result. The caller must implement idempotent append or recovery behind the handoff port; this issue does not claim durable storage exists.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). No ADR is needed; this follows the existing per-attempt ledger contract.
- Open decision: a concrete durable ledger/queue and provider reconciliation remain separate issues. The delegated actual provider remains unknown until verified generation metadata is available.

## TDD plan

- First add a managed coordinator test expecting one record for a successful attempt; confirm failure because no handoff occurs.
- Add delegated success, failed and possibly billed attempts, managed fallback, denial, and post-call handoff failure tests. Assert no prompt, response, token, or key enters records.
- Implement the smallest coordinator handoff and gateway port wiring. Run focused tests, formatting, and `npm run check`.

## Delivery

- Commit on `feat/23-gateway-usage-capture` with authorized DCO and assistance trailers; open a ready PR linked to #23 and this plan.
- The injected handoff has no deployed implementation yet. Operators cannot claim durable accounting until a backed port and recovery process are provided.
