# Authorized model discovery filter plan

## Issue and problem

- Issue #456; external-client gate #116 remains open. Compatible model discovery only accepts offset/limit, so official capability-filter requests fail before catalog reads.
- Trusted metadata already includes output_modalities, supported_parameters and nullable context_length. Installed OpenRouter 1.4.18 exposes scalar outputModalities/supportedParameters/context query fields.

## Scope and expected behavior

- Only /api/v1/models adds singleton output_modalities (one known modality or all), supported_parameters (one lower_snake_case token, at most 128 characters), and context (canonical positive decimal safe integer). Duplicates, comma lists, blanks, casing/whitespace variants, invalid bounds and unknown filters reject before catalog reads. These syntax bounds are a local subset of the upstream schema.
- Preserve no-filter behavior; do not inject the upstream's documented default text filter. Filter-only requests return the full matching sequence when both paging fields are absent. Explicit offset/limit retain their existing defaults/bounds. /v1 still rejects queries.
- Validate the complete catalog, evaluate enabled model/final-provider IAM, apply all supplied conditions to captured administrator metadata, then paginate in catalog order. Require exact membership and context_length >= context. Missing metadata/null context cannot establish the respective condition. output_modalities=all adds no modality condition.
- Return matching authorized total_count and fixed relative continuation links containing every accepted filter. Denied/disabled/nonmatching aliases consume no offset. Reevaluate fresh catalog/IAM per request, without cross-page snapshot guarantees.
- Listing calls no route-selection, secret, limit, inference or usage ports. Required sanitized audit precedes output; filters/metadata do not enter operational errors/events. Malformed out-of-page/denied entries invalidate the entire catalog before filtering.

## Design

- Extend the pure query parser with captured optional scalars, retain full-list behavior when no paging field occurs, and construct continuation parameters from validated fields only. Filter the authorized sequence using the existing frozen metadata map before slicing.
- Accepting comma lists would settle undocumented AND/OR/duplicate semantics. Defer that alternative; singleton exact membership is sufficient and grounded in the published metadata. Do not derive categories or live provider capability from parameter lists. Filters describe administrator-published information, not a guarantee of every route/model feature.
- No new glossary term, pricing policy, routing preference or costly irreversible decision. Source refresh/metadata provisioning, native capabilities, sorting/search/provider/region filters, multi-values and complete discovery workflows remain open.
- Sources: [official model query reference](https://openrouter.ai/docs/api/api-reference/models/get-models), [official schema](https://openrouter.ai/openapi.json), installed SDK serialization. The version-30 chat schema pin remains unchanged and does not certify model-query schema drift.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/model-discovery-filters.md), plus existing discovery/paging contract cross-references.

## TDD plan

- First HTTP/public tests expect selected authorized metadata and retained continuation filters; old parser returns 400 for valid filters. Installed SDK sockets reproduce the rejection. Record meaningful red outcomes before production changes.
- Cover each condition/boundary, conjunction, no-match, absent/null metadata, zero/unknown context, output all, exact parameter spelling, filter-only lists over 500, explicit paging defaults, safe offset beyond end and every invalid query class. Verify legacy behavior.
- Authenticate before syntax checks; current model/provider/implicit Deny and disabled aliases, fresh policy per SDK page, full-catalog malformed hidden/out-of-page entries, catalog/audit failures, metadata mutation during required audit, no sensitive operational projection and no inference-side ports.
- Smallest implementation: parser fields/default distinction, metadata predicates after IAM, validated continuation construction. Format, focused/raw SDK tests, npm run check and unchanged chat-pin integrity/fresh drift.

## Delivery

- Issue/new branch/plan, red tests, minimal implementation, all checks, exact published diff review, both green required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risks: stale administrator metadata may misstate live capability; unknown metadata cannot establish filtered capabilities. Policy/catalog changes can shift offset pages and repeat/skip entries. Singletons/no implicit text default are documented compatibility limits. Rollback does not require a migration.
- PR records public/SDK red/green, exact filtering/security evidence, full checks and material remaining #116/#7 gaps.

## Verification evidence

GET /api/v1/models now supports bounded singleton output_modalities, supported_parameters and minimum context filters alongside existing paging. Conditions use exact captured administrator metadata after enabled model/final-provider IAM and before paging. Omitted filters preserve current behavior; all imposes no modality condition, while unknown metadata/null context cannot establish an asserted capability. Filter-only requests retain full-list behavior without injecting a paging or text-filter default. Legacy /v1 queries remain rejected.

Matching authorized totals and fixed relative continuation links retain all accepted filters. Each request reevaluates current catalog and IAM. The whole catalog still validates before filtering, including denied/disabled/out-of-page records, and required sanitized audit precedes output. Listing invokes no inference routes, provider secrets, limits or usage ports. Update existing discovery/paging contracts and the compatibility inventory to describe the current behavior.

Red evidence: 64 new public HTTP cases initially produced 32 expected failures and 32 existing invariant passes; valid filters were rejected by the old parser. Eleven installed SDK socket cases produced eight expected failures and three existing invalid-query passes. Green evidence: all 64 new public cases and 11 new SDK cases pass; 93 focused discovery/paging/metadata/storage tests pass. New socket coverage exercises 18 actual SDK requests (12 successful and six denied), filter retention through exact terminal pages, current-policy denial, OpenAI list consumption and gateway rejection of SDK context=0/comma lists. Cases include each modality and exact parameter bound, conjunction, missing metadata, null context versus unrelated top-provider limits, filter-only 501-model lists, authentication, implicit/model/provider Deny, disabled aliases, safe catalog/audit failure, immutable audit-time metadata and beyond-end offsets.

Full npm run check passes 5,103 tests with one existing PostgreSQL skip. Fresh compatibility:drift passes, with the version-30 chat pin unchanged. No model-query source-drift certification is claimed.

Material limits: syntax/identifier bounds, singleton membership, conjunction and preserving omitted-filter behavior are explicit local subsets. Published parameter lists may be unions across provider endpoints and cannot certify capability on the selected authorized provider. Metadata can be stale; policy/catalog changes can shift offset pages. Rich OpenRouter SDK discovery still requires administrator metadata, whereas basic aliases remain available via raw HTTP/OpenAI SDK. Multi-values, broader filters/search/sorting, metadata refresh/provisioning, model-query structural drift, complete discovery and release gate #116 remain open, as does unresolved #7.


Full npm run check passes strict types, lint, 5103 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
