# Managed Routing without Jev

## Issue and problem

- Issue: [#45](https://github.com/Theorvane/OpenGranter/issues/45)
- The product design treats Jev as optional, but the current managed gateway always requires a Jev credential and decision call.

## Scope and expected behavior

- A managed route may omit Jev configuration. The gateway applies the existing model and final-provider IAM filter, checks limits, records the eligible IDs, then selects the first eligible direct candidate in administrator order.
- The decision audit identifies `source: "order"`; no Jev secret, call, prompt disclosure, or Jev usage is produced. Existing direct attempt accounting and same-kind fallback remain in force.
- Default/explicit Deny, limit rejection, and required audit failures stop before direct inference. The Jev-enabled route retains its existing behavior.
- Out of scope: price/latency/throughput ranking and route publication writes. The merged [#43](https://github.com/Theorvane/OpenGranter/issues/43) catalog schema must accept this route shape through a forward migration, while preserving the historical migration checksum.

## Design

- Generalize the managed invocation coordinator to accept optional Jev settings while preserving its existing Jev export for callers. Reuse the existing attempt loop and usage handoff for either selection source.
- Make the gateway route shape's Jev settings optional and forward prompt text only when explicitly enabled. An ordered route supplies no Jev settings.
- Add the ordered decision to the nonsecret audit projector. Do not interpret absence of Jev as a failed Jev call. Add migration `006` to allow managed routes whose three Jev columns are all null; update the catalog reader to omit Jev settings for that stored shape and reject partially populated settings.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [routing contract](../routing.md), [acceptance](../acceptance.md), and [gateway cases](../../contracts/gateway_cases.json). No ADR is needed: optional Jev is already an agreed product direction.
- Open decisions: other ranking algorithms, product defaults for Jev disclosure, and the administrative publication API for ordered managed routes.

## TDD plan

- First write an HTTP-boundary test for a managed route without Jev. Expect a failure before direct inference under the current required-Jev code.
- Add denied provider, limit, audit-write failure, fallback after a classified pre-response timeout, and no Jev/secret/prompt contact assertions. Test audit projection of the ordered decision. After #43 merges, add a red PostgreSQL test for a persisted no-Jev route and its gateway invocation before changing the schema and reader.
- Implement the smallest optional-selection change, refactor shared coordinator naming, run focused tests, then `npm run check`.

## Delivery

- Commit on `feat/45-ordered-managed-routing` with authorized DCO and assistance trailers; open a ready PR linked to the issue and plan.
- A malformed route still fails closed through the gateway's fixed error mapping. The key risk is accidentally weakening Jev-enabled or IAM behavior, so existing tests must remain green.
