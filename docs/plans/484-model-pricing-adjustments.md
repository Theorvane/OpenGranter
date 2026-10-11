# Model pricing adjustments plan

## Issue and problem

- Issue #484. Full OpenRouter release gate #116 and unresolved #7 stay open.
- Administrator model snapshots reject the standard optional pricing.discount and pricing.overrides fields. Authorized external clients cannot see published pricing adjustments.
- Fresh factual sub-agent checks on 2026-10-11 confirm PublicPricing/PricingOverride match the existing model-response pin. All fourteen existing scalar price fields are already supported.

## Scope and expected behavior

- Own optional discount: finite number, without inferred range. Own optional overrides: non-null array of 0..64 non-null known-field objects, allowing empty rows, duplicates and supplied order.
- Override optional non-null fields: seven price strings (prompt/completion/audio/input_audio_cache/input_cache_read/input_cache_write/input_cache_write_1h), three finite numbers (min_prompt_tokens/utc_start/utc_end) and utc_days (1..64 exact open strings of 0..256 UTF-16 units). Preserve signed/fractional condition values and blank/future/duplicate day labels; never normalize, sort or deduplicate.
- Existing price restriction remains exact nonnegative decimal/scientific spelling <=128 units whose numeric conversion is finite. Supplied own undefined/null, wrong or nonfinite types, unknown fields, array holes even with inherited fillers and excessive bounds reject the whole catalog safely. Required base prompt/completion must be own. Inherited optional values are omitted, including throwing getters.
- Capture own values, validated lengths and bounded own indices once; ignore supplied iterators and deeply freeze before audit/database handoffs. Complete hidden-catalog validation, model AND final-provider IAM/explicit Deny, current filters/order/paging and required private audit remain shared; no operational pricing data or listing inference/routing/secret/limit/usage calls.
- No discount arithmetic, threshold/time matching, inherited-price computation, price ranking/route selection, fetching, freshness/billed-cost authority or management API. Existing basic/legacy shapes, approved routes, nullable JSONB object/64 KiB cap, migrations and all three pins remain unchanged. Independently valid bounds may still exceed the aggregate storage cap.

## Design

- Extend pricing types with explicit required base prices plus typed optional price fields, discount and overrides. Reuse exact decimal validation and finite numeric validation; add own conditional override capture and bounded array/day snapshots. Shared HTTP and PostgreSQL boundaries already normalize/project snapshots.
- The [official schema](https://openrouter.ai/openapi.json) has no numeric ranges/defaults; utc_days alone requires minItems=1. Installed OpenRouter1.4.18 accepts empty days but the explicit source minimum takes precedence. SDK permits arbitrary scalar prices and strips unknown fields; keep our existing lexical/known-field restrictions explicit. SDK maps inputAudioCache/inputCacheRead/inputCacheWrite/inputCacheWrite1h/minPromptTokens/utcDays/utcStart/utcEnd. OpenAI7.23.0 preserves raw extra JSON.
- Prefer shared snapshot extension over a new management/ranking/billing mechanism. Preserve price spelling and metadata-only authority. No new domain term or costly irreversible trade-off/ADR is introduced. Publication/refresh, matching/application semantics, live pricing certification and full #116/#7 remain separate decisions.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [base contract](../../contracts/model-discovery-metadata.md) and [pricing contract](../../contracts/model-pricing-adjustments.md).

## TDD plan

- First public/storage/actual SDK tests expect published discount/overrides; the current validator returns 503. Record behavioral red before production changes, then extend only the shared snapshot.
- Cover finite signed/fractional/extreme discounts/conditions, empty/duplicate override rows, exact decimal spelling, all fields, open/blank/Unicode/duplicate day strings, omission and array/string bounds. Reject nonfinite/null/undefined/malformed/unknown fields, empty supplied day arrays, holes and inherited required prices safely, including hidden entries.
- Verify authentication order, implicit/model/provider Deny, required dependency failures, fresh SDK pages, private errors/events, legacy/basic/query/order behavior, getter single capture, inherited omission, throwing getters, custom iterators and audit mutation.
- PostgreSQL list/route reads remain deeply frozen and preserve approved routes; migrated JSONB round trips cover no-backfill, exact prices/duplicates and aggregate cap. Format changed files, focused red/green and full npm run check.

## Delivery

- Issue/new branch/plan before production code. PR links plan and contract, records red/green/full checks and limitations. Review exact published diff; sjungwon03-ai exact-head approval and both CI check jobs precede sjungwon03 squash merge/main synchronization.
- Downgrading requires removing newly supported fields. Stale, inaccurate or unusual pricing information remains possible; no live billing claim follows. Publication/refresh, broader discovery/conformance, full #116 and unresolved #7 remain open.

## Verification evidence

Publish optional administrator pricing.discount and pricing.overrides in compatible rich model discovery. Preserve finite discount/token/time numbers without inferred ranges, exact bounded price spellings, open UTC day labels, empty/duplicate override rows, duplicate days and supplied order. All override fields are optional; supplied utc_days must contain at least one member under the official schema. Local limits are 64 override/day members, 256 UTF-16 units per day label and the unchanged 128-unit nonnegative decimal/scientific price restriction.

Extend only shared typed pricing snapshots. Capture each known own value, validated array length and bounded own index once; deeply freeze pricing/override/day structures, ignore supplied iterators and reject inherited hole fillers. This also fixes incomplete output for non-enumerable own required prompt/completion properties reproduced before implementation. All fourteen existing scalar price fields retain exact values and SDK mappings; inherited optional fields are omitted. Complete hidden-catalog validation, enabled model/final-provider IAM/Deny, required private audit, fresh page policy, unchanged basic/legacy/query/order and approved routes remain shared. No condition matching, discount/inherited-price arithmetic, fetching, provider ranking, route selection or billed-cost authority is added. Migrations, nullable JSONB object/64 KiB cap and all three pins stay unchanged.

TDD: node --experimental-strip-types --test test/model-pricing-adjustments.test.ts test/sdk-model-pricing-adjustments.test.ts initially produced 144 passes and 26 expected behavioral failures (valid adjustments returned 503, SQL validation/SDKs rejected them, and own non-enumerable base prices were omitted). The smallest snapshot extension made all 170 green; two additional public/SDK regressions and expanded getter coverage retain all fourteen existing scalar price fields. All 172 new cases pass. Full npm run check passes strict types, lint, 6131 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and offline schema integrity.

Risks/remaining scope: informational pricing may be stale, inaccurate or semantically unusual. Finite discounts/conditions are not normalized or applied. Enforced source utc_days minItems=1 differs from the permissive installed SDK; price grammar, known-field/own-required and length/count limits are explicit local restrictions. Individually valid bounds can exceed the unchanged aggregate storage cap and be rejected. Downgrades require removing newly supported fields. Publication/refresh, pricing application policy, broader discovery/conformance, full #116 and unresolved #7 remain open.

