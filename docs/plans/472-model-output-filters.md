# Model output modality list plan

## Issue and problem

- Issue #472; release gate #116 and unresolved #7 remain open.
- The compatible model list rejects documented output_modalities=text,image. Existing singleton filters cannot discover multiple output types in one request.

## Scope and expected behavior

- GET /api/v1/models accepts one to nine distinct exact output modalities in one comma-separated string; match any listed modality. Keep all standalone and preserve omitted-filter behavior with no implicit text default.
- Keep input_modalities and supported_parameters singleton. Preserve conjunction across different filter fields, search, ordering, paging defaults and legacy /v1 query rejection.
- Reject blank/duplicate/unknown/case/whitespace items, mixed all and repeated keys before catalog reads. Duplicate rejection and finite vocabulary bounds are explicit local restrictions; upstream accepts duplicate values.
- Evaluate enabled model and final-provider IAM before metadata filtering. Missing metadata fails any explicit output list. Validate the whole catalog first. Fresh catalog/IAM applies independently to each page.
- Required sanitized audit precedes output; filters/metadata stay out of operational events/errors. Listing invokes no inference, route, credential, limit or usage ports.

## Design

- Capture a frozen validated output list in the pure query parser; use any exact membership against captured administrator metadata. Continuations join the validated list into one encoded scalar and retain its order.
- Official [models guide](https://openrouter.ai/docs/guides/overview/models) documents text,image. Credential-free official list probes on 2026-10-06 returned both text-only and image-only entries for text,image and image,text, supporting union semantics by empirical inference. all,image rejected; text,text was accepted upstream. Official schema uses a plain string, without local bounds or combination rules.
- Installed OpenRouter1.4.18 serializes a comma string as one query value and retains it during iteration. No new dependency, schema selection, metadata provisioner, routing policy, glossary term or ADR is needed.
- Leave other multi-value semantics and model capability/metadata freshness unresolved. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/model-output-filters.md).

## TDD plan

- First public regression expects text-only and image-only authorized aliases for text,image; current parser returns400. Installed SDK requests reproduce rejection before production edits.
- Cover reversed order, all nine values, exact URL encoding, conjunction/search/order, full lists over500, paged retention, fresh Deny, hidden/disabled metadata, missing/empty metadata, invalid syntax, legacy queries, authentication, whole-catalog and required audit failures, audit-time metadata mutation and operational privacy.
- Smallest change: output list validation/capture, any-member predicate and scalar continuation encoding. Keep other fields unchanged.
- Format changed files; run focused public/SDK discovery tests and npm run check. Existing three source pins remain byte-identical; runtime tests do not certify complete schemas or live capabilities.

## Delivery

- Issue, new branch and plan precede coding; record meaningful red/green. Publish a focused PR, inspect exact diff, wait for both exact-head check jobs, review as sjungwon03-ai and squash merge as sjungwon03.
- Rollback is code-only. Published metadata can be stale and model-level capability unions cannot guarantee selected-provider support. Offset pages can shift when policy/catalog changes; no snapshot guarantee. Basic aliases remain outside rich OpenRouter SDK metadata validation.

## Verification evidence

GET /api/v1/models previously rejected documented output_modalities=text,image. It now accepts one to nine distinct exact output modalities as one comma-separated value and selects any matching captured published output after enabled model AND final-provider IAM. Standalone all and omitted-filter behavior are preserved. Different fields retain conjunction; search/order/paging and fixed relative continuations keep validated list order. Input/parameter multi-values remain unsupported.

Red evidence: 38 new public regressions initially produced14 expected failures (valid lists returned400) and24 invariant passes; four new actual SDK socket cases all failed on gateway400 before production edits. Green evidence: all42 new cases and186 focused discovery tests pass. Coverage includes both route kinds, all nine outputs, union/reversed order/no-match, missing/empty metadata, combined search/order/filters, filter-only501 rows, exact continuation encoding, authentication, model/provider/implicit/explicit Deny and fresh SDK page denial, malformed whole-catalog metadata, required audit/catalog failures, source mutation and sanitized operational records. Installed OpenRouter1.4.18 injects default paging; OpenAI7.23.0 retains filter-only requests. Ten added successful SDK requests exercise union, iteration and policy changes.

Official guide and credential-free official list observations support output union; that semantic evidence is distinct from the existing plain-string structural pin. Duplicate rejection and finite vocabulary bounds are explicit local restrictions (upstream accepts duplicates). Omitted filters still have no implicit text default. All three source pins remain byte-identical. Published metadata can be stale and cannot guarantee selected-provider capability. Offset pages can shift with current policy/catalog; there is no snapshot guarantee. Rich OpenRouter SDK metadata requirements, input/parameter lists, other discovery filters, metadata refresh, complete #116 and unresolved #7 remain open. Listing still invokes no inference, route, secret, limit or usage ports.


Full npm run check passes strict types, lint, 5595 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
