# Support benchmark model discovery sorting

## Issue and problem

- Issue: [#498](https://github.com/Theorvane/OpenGranter/issues/498), part of #116.
- Compatible model listing publishes reviewed benchmark metadata but rejects the four official benchmark ordering modes. External tools cannot request ordering by those scores.

## Scope and expected behavior

- Accept `intelligence-high-to-low`, `coding-high-to-low`, `agentic-high-to-low` and `design-arena-elo-high-to-low` on GET /api/v1/models. Use the captured Artificial Analysis index or the maximum published Design Arena ELO across arenas.
- Missing/null index, absent metadata and empty arena arrays sort last; signed/zero/extreme finite scores remain scores. Preserve catalog order for equal or missing scores as a local tie rule.
- Retain complete catalog validation, enabled model AND final-provider IAM, combined filters, sorting before paging, fixed relative continuations, fresh page authorization and required private audit.
- No benchmark fetching, normalization, automatic routing, billing/capability inference, new storage schema or /v1 query support. All three source pins remain unchanged.

## Design

- Extend the bounded query sort union/parser and add a pure comparator over validated immutable metadata. Compare finite scores relationally to avoid overflow when subtracting opposite extreme values. Keep selection and authorization in the existing gateway boundary.
- Fresh official [OpenAPI](https://openrouter.ai/openapi.json) inspection on 2026-10-18 confirms all four sort values, descending indices, best arena ELO and missing-score-last semantics. Existing model-query pin v2 already contains these enum values. Tie order is local, not a claimed upstream guarantee.
- Update [contract](../../contracts/model-benchmark-order.md), [exploration contract](../../contracts/model-discovery-exploration.md), [compatibility](../openrouter-compatibility.md), [acceptance](../acceptance.md), PRD and architecture. No new domain term or ADR is required.

## TDD plan

- First write public raw HTTP cases for each score mode on managed/delegated catalogs and observe 400 instead of the required 200.
- Cover ties, missing/null/empty values, negative/zero/extreme scores, best-of-arena selection, combined paging/continuations, model/provider/implicit Deny, fresh page policy, authentication-before-query, malformed syntax/catalog, required failures, audit-time mutation and operational privacy.
- Exercise installed OpenRouter/OpenAI SDK sockets and actual serialized sort queries. Implement the smallest parser/comparator/gateway changes, format and run `npm run check`.

## Delivery

- Publish the issue branch and ready PR with this plan, red/green and full-check evidence; require CI and approval before merge.
- Limit: administrator benchmark metadata can be stale/inaccurate and is not independently verified. Listing order grants no route permissions or model quality guarantee. Broader sort modes, metadata refresh, complete #116 and unresolved #7 remain open.

## Verification evidence

- Red before implementation: the initial raw suite had 15 failures (unsupported sort returned 400 instead of 200) and two existing-denial passes; all nine installed SDK cases failed for the same unsupported query.
- Green: 27 new public/SDK cases pass, including missing optional benchmark shapes. The combined benchmark and existing exploration/SDK regression command passes 101 cases.
- After approved PR #497 merged, rebase on main and retain both overlapping documentation additions. Plain `npm run check` with `NODE_NO_WARNINGS` and `NODE_OPTIONS` absent passes 6,644 tests with one optional external PostgreSQL skip, strict types, lint, planning/contracts and all three offline pins on Node 22.14.0. No global warning workaround is required.
