# Track chat usage schema drift

## Issue and problem

- Issue: [#244](https://github.com/Theorvane/OpenGranter/issues/244), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Unchanged response usage references currently hide structural changes to token counters, nullable costs and nested usage details.

## Scope and expected behavior

- Select exactly ChatUsage, CostDetails and ServerToolUseDetails in usageDefinitions, including required lists, types/nullability, constraints, references and literal defaults. Ignore editorial annotations.
- Explicit version-10 refresh preserves all version-9 projections. Missing/malformed definitions and rehashed missing/extra/malformed maps reject; reject stale versions 1..9.
- No runtime/client/provider projection, usage estimation/billing, IAM, secrets, audit or supported capability changes. No full response-instance or external-client conformance claim.

## Design

- Reuse the bounded structural projector with a separate exact three-entry map. Both ChatResult and ChatStreamChunk reference ChatUsage; its two referenced detail definitions have no further references, and token details are inline.
- Alternative: recursive schema traversal would broaden scope unnecessarily. Keep native provider usage and unrelated response/image usage definitions unselected.
- Official source: [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), checked 2026-10-02. Repository-required read-only fact audit confirms the selection and fixture changes. No new domain term or ADR.
- Depends on [#243](https://github.com/Theorvane/OpenGranter/pull/243). Start from current main and include its pending schema dependency; after dependencies merge, rebase only issue-244's commit and revalidate.
- Update PRD, architecture, acceptance, compatibility inventory and schema-drift contract with this bounded source guard.

## TDD plan

- First regression asserts the exact usage map and fails because it is absent before implementation.
- Cover counter type/required/bounds, cost nullability/format, inline token details, reference changes, server-tool counters, literal defaults, annotation-only stability and ignored unrelated/native definitions.
- Verify malformed sources and rehashed missing/extra/malformed map failures. Populate the source fixture from the reviewed pin, add the minimum selection/version gate and explicitly compare all previous projections before refresh.
- Run focused schema tests, formatting, npm run check and live compatibility:drift.

## Delivery

- Record red/green, full checks and reviewed provenance in the PR linked to this plan.
- Risk: tracked billing/server-tool fields do not imply runtime preservation or server-tool support. Unknown usage and estimated versus billed cost remain governed by existing accounting contracts.
- Rollback pairs pin and projector versions; merge only after dependency, required CI and approval.

## Verification evidence

- Red: exact usage-map assertion failed because usageDefinitions was absent before implementation.
- Green: 68 focused schema tests pass. npm run check passes 1,062 tests with one existing skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Live compatibility:drift passes. Explicit refresh preserves all version-9 projections and official canonical source SHA-256 b02d61edfa13dd8f531f1d4429e62164fe28ddb6bb048aac64dca2f2b8bcfe66.
- #243 and its #237 dependency remain approval-gated. Rebase only this issue's commit after their merge and revalidate before merging.
