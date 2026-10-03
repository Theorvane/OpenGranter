# IAM-filtered compatible model list paging

## Issue and problem

- [#230](https://github.com/Theorvane/OpenGranter/issues/230), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116). Explicit official SDK model lists and subsequent pages use offset/limit, currently rejected.
- Dependency: [#228](https://github.com/Theorvane/OpenGranter/issues/228) / [PR #229](https://github.com/Theorvane/OpenGranter/pull/229) supplies rich metadata. Create the branch from main and locally fast-forward to the reviewed dependency; keep it explicit until merged, then rebase only this issue onto main before merge.

## Scope and expected behavior

- Only /api/v1/models permits singleton offset/limit. Strict decoded decimal safe integers, offset>=0 and limit 1..1000; query defaults offset0/limit500. No query retains the full list. Legacy /v1 query rejection and other filter rejection remain.
- Validate the entire catalog, apply model/final-provider IAM, then slice current visible order. total_count is the full visible count; required audit records only returned count. Fixed relative next links preserve bounded offset/limit and never use caller-controlled hosts.
- No secrets, inference, limits or usage calls. Capture metadata before audit; malformed denied/out-of-page metadata still invalidates the catalog. Denied aliases never consume offsets or leak counts.
- Each request evaluates current policy/catalog. Cross-request snapshot stability, new filtering/sorting/count endpoints and complete client conformance remain separate work.

## Design

- Small pure query parser plus minimal handler slicing after shared authorization. Existing SQL order remains; no new catalog order or aggregation policy.
- [Official model-list docs](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), checked 2026-10-02: offset>=0, limit1..1000, defaults0/500 and both omitted means full list. Canonical decimal syntax is a documented local restriction.
- Installed SDK 1.4.18 sends no query for list(), but sends defaults for list({}). It continues by returned count rather than links.next/total_count, so exact multiples need a terminal empty request. Preserve this behavior without hiding data.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), discovery and SDK contracts. No domain term or ADR change.

## TDD plan

- First public regression expects offset/limit listing success instead of current 400. Actual SDK iteration first fails with BadRequest. Record red before implementation.
- Cover visible-only offsets/counts, explicit Deny in both scopes, disabled entries, bounded/default/null SDK values, terminal empty pages, no-query large-list iteration, fixed next links, unknown/duplicate/malformed query rejection before catalog reads, full-catalog failure, audit failure and legacy behavior.
- Implement parser/slicing, retain captured projections, format and run npm run check.

## Delivery

- Red: the two initial public-boundary regressions failed before implementation: raw offset/limit returned 400 instead of 200, and official SDK iteration raised BadRequestResponseError. Green: all nine focused paging tests pass. Full npm run check passes with 1,064 tests passing and one existing skipped test; type checking, lint, planning documents and offline source-pin integrity pass.
- New issue/plan/branch and focused PR; dependency must merge first. Report red/green and full-check evidence. Merge only after approval and required CI.
- Risk: offsets can skip/repeat aliases if policy/catalog changes between requests; reevaluation must take precedence over snapshot convenience. Unconfigured aliases still fail SDK model-schema validation. Metadata provisioning/refresh, broader query filters and full workflows remain open.
