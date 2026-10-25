# Reported Anthropic Service Tiers

## Issue and problem

- Issue: #536; refs #116 and #7.
- Native Anthropic `usage.service_tier` is currently discarded in JSON and SSE normalization. Existing compatible response and stream summaries already support nullable string tier metadata.
- Started independently from approved main 78d5d29. After exact-head approval, three successful checks and explicit user merge authorization, PR #535 merged as 6e4b6ca. Fast-forwarded this branch onto that approved main while preserving the independent response changes; request-tier mappings remain unchanged.

## Scope and expected behavior

- Read an actually supplied own native usage.service_tier and expose it as compatible response service_tier. Preserve exact string/null/omission without translating native values or inferring them from requests, token counts, model names, headers or prices.
- Match the compatible nullable-string contract, including future opaque strings; nonstring/non-null values fail with fixed private errors and existing possible-billing accounting. This is provider-reported metadata, not a capability or billed-price assertion.
- For text/function streams, capture initial and later usage reports; absent reports retain the prior value, explicit null replaces it, and latest supplied value wins. Return metadata only through the existing completed summary/final HTTP frame after required audit/usage. Do not retain opaque usage objects or emit tier in content deltas.
- Keep token/cache accounting separate and unchanged. Tier-only usage cannot manufacture tokens or cost; preserve authentication/IAM/limits, mandatory persistence, native parsing/failure/cancellation and all request controls.
- No source-pin, dependency, migration, operational event or ledger changes. Broad #116 and Jev #7 remain open.

## Design

- Add a narrow shared native usage-tier reader returning a primitive string/null/undefined. Keep it separate from the token/cache usage counter class so metadata cannot enter the ledger.
- Apply it to all three Anthropic nonstream result branches and both native SSE consumers. Capture only primitives; merge final metadata into existing summary types and let existing managed HTTP/SDK paths serialize it.
- A tier-only native report exposed an additional shared encoder omission: the existing encoder discarded final metadata with incomplete counters. Preserve a supplied tier-only final frame without serializing a numeric usage object, backed by a separate failing regression. Do not modify shared streaming types or invent response fields. Preserve existing native usage-container failure/absence semantics outside the selected tier field; this is not whole-response validation or an API-version upgrade.
- Update the [service-tier contract](../../contracts/service-tier-requests.md#reported-anthropic-response-tiers-536), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [handoff](../HANDOFF.md). No new domain term or costly architectural decision is introduced. No unresolved product choice is settled here; delegated endpoint-tier expansion remains separate.
- Sources checked 2026-10-25: [Anthropic service tiers](https://platform.claude.com/docs/en/api/service-tiers), [Messages API](https://platform.claude.com/docs/en/api/http/messages/create), and the installed compatible SDK's nullable-string response schemas. Native standard/priority/batch values are reports, distinct from normalized request preferences.

## TDD plan

- First run native/public/actual SDK tests expecting preserved reported strings/null and stream updates. Current code drops tiers and accepts malformed selected values; record both failures before production changes.
- Cover both bases, nonstream/text/refusal/function outputs, exact opaque future strings, omission/null, initial/update/terminal reports, omitted/null updates, tier-only usage, malformed values before/after output, private error/accounting behavior and required persistence failures.
- Test auth/implicit/model/provider Deny/limits before upstream calls and audited body cancellation. Verify operational records exclude tier metadata and request preferences cannot create served tiers.
- Implement the smallest shared reader and three consumer integrations; run focused native/service-tier/SDK/cache regressions, strict checks and `npm run check`. Verify existing six pins/dependencies/storage remain unchanged.

## Delivery

1. Issue, fresh branch and this English plan before code.
2. Failing boundary cases; minimal implementation; green and regression evidence.
3. Update contracts/planning/handoff and complete full checks.
4. Ready PR with evidence, source/SDK limits and user author/committer, DCO and Assisted-by trailers.
5. Merge only on exact-head approval and successful required CI. Integrate PR #535 independently only after it meets those gates.

Risks/rollback: upstream metadata can change independently of requests. No mapping to price, SLA or routing authority is allowed. Revert reader and JSON/SSE integrations together to restore prior omission; keep existing request and counter behavior intact.

## Verification evidence

- Initial red: native/public/SDK suite ran 43 cases, with 35 expected failures and 8 passes before implementation. Failures reproduced missing native response tiers and acceptance of malformed selected values.
- First implementation left three tier-only stream cases failing. A separate text/function encoder regression ran two cases, both failing before the encoder change. Preserve metadata without weakening fixtures or manufacturing counters.
- Integrated reader/consumers/encoder green: 59 public/SDK/encoder and existing SSE cases passed; strict type checking passed. After approved-main integration, the 16-suite selection passed 494 cases.
- First full gate ran 7,295 cases: 7,292 passed, two existing official SDK cases failed and one optional external PostgreSQL case skipped. Both failures expected missing usage to suppress final metadata even when a tier was supplied. Update those assertions to require tier-only final frames while verifying that numeric usage stays absent; the unchanged no-tier case still emits no additional frame. The expanded 17-suite regression selection then passed all 515 cases. The final full gate passed 7,294 of 7,295 cases with zero failures/cancellations and one optional external PostgreSQL skip. Type checking, lint, planning/contracts/secret checks and all six offline pin checks passed. Existing unrelated lint output remains 42 warnings and 65 informational diagnostics.
- No live inference or provider credentials were used. Official documentation and installed response schemas support metadata projection, not capacity or billing guarantees.

- All six live fixed-source comparisons passed without pin writes. Final document/diff checks passed after recording this evidence. Dependencies, source pins, migrations and operational schemas are unchanged.
