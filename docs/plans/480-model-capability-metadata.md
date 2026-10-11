# Reasoning and alias model metadata plan

## Issue and problem

- Issue #480; broad compatibility gate #116 and unresolved #7 stay open.
- Standard optional reasoning and alias_target objects are rejected by the administrator snapshot allowlist, withholding published characteristics from authorized external clients.

## Scope and expected behavior

- Own optional reasoning must be a non-null object with own required mandatory:boolean. Own optional default_enabled/supports_max_tokens are booleans; default_effort is string|null; supported_efforts is array|null of string|null. Preserve exact open enum strings, null/omission, empty arrays, duplicates and order. Local bounds: 64 efforts, 0..256 UTF-16 units per string.
- Own optional alias_target must be a non-null object with own required slug/name strings of 0..256 UTF-16 units. Preserve exact blank/Unicode values; no parsing, normalization or default.
- Reject supplied undefined/null root objects, malformed scalars, missing required own fields, unknown nested keys, holes and excessive lengths/counts with existing fixed errors. Read each supplied value once and freeze root/nested objects and efforts before asynchronous handoffs. Inherited optional values are omitted.
- Keep complete-catalog validation before enabled model AND final-provider IAM, current search/filter/order/paging and required private audit. Each page reevaluates current policy. Metadata stays out of operational records/errors; basic/legacy rows keep their shape. Listing calls no inference/routing/secret/limit/usage ports.
- Metadata does not enable reasoning, apply request defaults, grant capability/provider permissions, resolve/redirect aliases or change approved routes, token estimates, limits or billing. No publication/refresh API, native thinking behavior, storage migration or backfill is added.

## Design

- Extend the existing TypeScript interface/known-field allowlist with two conditional own-object snapshots. Share bounded exact text/null validation; add strict boolean and bounded nullable-effort-array capture helpers. Reuse existing HTTP projection and PostgreSQL listing/route validation.
- Fresh official schema and installed SDK checks on 2026-10-11 confirm optional non-null objects, required mandatory/slug/name, boolean optionality, nullable effort arrays/items and open strings. [Official schema](https://openrouter.ai/openapi.json) and [models reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties). Local bounds, own required fields and unknown-key rejection are explicit restrictions. A read-only factual sub-agent checked shapes, without making product decisions.
- OpenRouter 1.4.18 maps aliasTarget, defaultEffort/defaultEnabled/supportedEfforts/supportsMaxTokens; OpenAI 7.23.0 retains raw additional fields. All three pins already select these structures and stay byte-identical. Existing nullable JSONB object/64 KiB cap remains.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [base contract](../../contracts/model-discovery-metadata.md) and [capability contract](../../contracts/model-capability-metadata.md).
- No new glossary term or costly irreversible trade-off requires an ADR. Capability aggregation/refresh, automatic defaults, alias redirects and live endpoint guarantees remain separate decisions.

## TDD plan

- First public/storage/SDK probes expect valid reasoning/alias objects; current validator returns 503. Record behavioral red before production changes, then implement the minimum snapshots.
- Cover mandatory true/false, optional booleans, all supported/open efforts, null/omission, empty/duplicate/null-member arrays, exact text and count/UTF-16 bounds; malformed/unknown/incomplete objects, array holes, hidden catalog entries and thrown getters.
- Verify authentication order, implicit/model/provider Deny, required audit/catalog failure, legacy/basic shapes, unchanged query capability/search behavior and fresh SDK page Deny. Capture root/nested/array getters once, ignore inherited optional getters and survive source mutation during audit.
- Fake PostgreSQL list/route snapshots retain approved routes and nested freezing; migrated PGlite JSONB round trips retain no-backfill and cap behavior. Installed OpenRouter/OpenAI socket probes verify mappings, pages and safe failure. Format changed files and run focused tests plus full npm run check.

## Delivery

- Issue/new branch/plan before code; update contracts and acceptance. PR links the plan and reports red/green, full-check evidence and material limitations. Root reviews the exact published diff; both exact-head check jobs and sjungwon03-ai approval precede sjungwon03 squash merge.
- Downgrading requires removal of newly supported stored keys. Administrator data may be stale; advertised defaults/capabilities and alias targets are informational rather than gateway authority. Broader discovery, full #116 and unresolved #7 remain open.

## Array boundary refinement

Two further behavioral regressions reproduced inherited array-hole acceptance and execution of a supplied iterator (64 passes, 2 expected failures in the public file). Capture one validated length and bounded own indices, rather than iteration, preserving duplicate/null ordering while rejecting holes even with inherited fillers and never invoking a supplied iterator. The resulting complete new public/storage/SDK suite has 74 cases.

## Verification evidence

Publish optional administrator reasoning and alias_target snapshots on compatible rich model discovery. Preserve exact required/optional booleans, open nullable effort strings/arrays and alias display strings, with local 64-member/256 UTF-16 unit bounds. Capture root/nested values and own array indices once, freeze the result and reject incomplete/unknown/malformed objects safely.

The shared HTTP/PostgreSQL validator keeps complete hidden-catalog checks, enabled model/final-provider IAM, required private audit, fresh paging policy, unchanged basic/legacy/query behavior and approved routes. Metadata never applies reasoning defaults, redirects an alias, grants feature/provider authority or affects token accounting. Existing JSONB shape/64 KiB cap, migrations and all three pins remain unchanged. Product, architecture, acceptance and contracts document the subset and its limits.

TDD: node --experimental-strip-types --test test/model-capability-metadata.test.ts test/sdk-model-capability-metadata.test.ts initially produced 46 passes and 26 expected failures (valid snapshots returned 503, PostgreSQL rejected them and SDKs received catalog_unavailable). After initial green, two array regressions reproduced inherited hole fillers and supplied iterator execution: 64 passes/2 expected failures in the public file. Bounded own-index capture makes all 74 new public/storage/SDK cases green. Full npm run check passes strict types, lint, 5856 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and offline schema integrity.

Risks/remaining scope: administrator metadata may be stale or semantically inconsistent; shape validation does not certify live provider support, target existence or authorization. Bounds/own-required/unknown-key rules are local restrictions. Downgrading requires removing newly supported stored fields. Publication/refresh, automatic defaults/redirect policy, remaining fields, full #116 and unresolved #7 remain open.

