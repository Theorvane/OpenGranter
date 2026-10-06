# Model capability list plan

## Issue and problem

- Issue #474; release gate #116 and unresolved #7 remain open.
- The compatible list still rejects official comma input/parameter filters, preventing clients from discovering aliases with multiple required capabilities.

## Scope and expected behavior

- GET /api/v1/models accepts input_modalities as one comma string of one to four distinct exact text/image/audio/file values; supported_parameters as one comma string of one to64 distinct lower_snake_case identifiers, each1..128 characters. The64 bound matches existing published metadata array capacity.
- Every requested input and every requested parameter must occur in captured administrator metadata. Missing/empty metadata fails an asserted list. Parameter all is an ordinary identifier; unknown valid identifiers use exact matching, never ignored or wildcarded.
- Preserve output any-member semantics, standalone output all, omitted filters/no implicit text default, conjunction across fields, search/order, paging/full lists and /v1 query rejection. Reject empty/duplicate/unknown-input/case/whitespace values and repeated keys before catalog reads.
- Validate the complete catalog and enabled model AND final-provider IAM before all-member filtering. Required sanitized audit precedes delivery. No route, inference, secret, limit or usage calls; filters/private metadata stay out of operational errors/events. Each page rechecks current catalog/IAM.

## Design

- Capture frozen validated input/parameter arrays in the query parser, use every-member predicates against captured published metadata, and join arrays into single validated continuation scalars retaining requested order.
- [Official reference](https://openrouter.ai/docs/api/api-reference/models/get-models) documents comma strings. Complete credential-free fixed-host observations on2026-10-06 with output_modalities=all show image/file pair176 exactly equals singleton intersection376/187; tools/temperature285 equals singleton intersection374/378; tools/structured_outputs319 equals intersection374/363. Reversed pairs agree and every returned row includes all requested values. AND is empirical support for this bounded local contract, not a schema-encoded guarantee.
- Upstream duplicate and unknown/all behavior is more permissive. Preserve local uniqueness, exact membership and input vocabulary; do not turn unknown values into omitted conditions. Installed OpenRouter1.4.18 keeps comma strings during scalar serialization/iteration; OpenAI7.23.0 accepts the filtered URL.
- No schema expansion, new metadata provisioner, authorization or costly domain decision. All three source pins remain unchanged. Metadata freshness, selected-endpoint capabilities and other discovery fields remain open; no new glossary/ADR is needed.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/model-capability-lists.md).

## TDD plan

- First public tests expect all-member intersections for input and parameter pairs; current parser returns400. Actual SDK tests independently reproduce the rejection before production edits.
- Cover one/four inputs and64 parameters,128-character tokens and excessive bounds, both route kinds, pairs/order/no-match, unknown/all parameter exact membership, mixed output union and all other filters, preserved continuations, filter-only501 models, auth/implicit/model/provider/explicit Deny, fresh SDK policy, whole-catalog validation, required audit/catalog failure, metadata mutation and private records.
- Smallest implementation: array parse/capture, every-member predicates and scalar continuation joins. Replace now-obsolete comma rejection fixtures with malformed/unknown cases; retain all other rejection coverage.
- Format changed files, focused public/SDK discovery regressions and npm run check. Check three source pins byte-identical.

## Delivery

- Issue/new branch/plan, meaningful red, minimal green, full checks and exact published diff review; both required exact-head CI jobs and sjungwon03-ai approval precede sjungwon03 squash merge.
- Code-only rollback. Metadata is informational/stale and may union providers; matching grants no invocation permission or selected-provider capability. Current catalog/policy can shift offset pages without snapshot guarantees. Complete #116 and unresolved #7 remain open.

## Verification evidence

Compatible discovery previously rejected documented input_modalities=text,image and supported_parameters=tools,temperature. GET /api/v1/models now accepts one to four distinct exact inputs and one to64 distinct lower_snake_case parameter identifiers, each1..128 characters, as single comma strings. Require every requested input and parameter in captured published metadata after enabled model AND final-provider IAM. Preserve output union, standalone output all, cross-field conjunction, search/order/paging, full-list omission and relative continuations retaining scalar order. Parameter all/unknown valid identifiers match exactly, never wildcard or disappear.

Red evidence:61 public regressions initially produced31 expected valid-list400 failures and30 invariant passes; all five actual SDK cases independently failed on gateway400 before production edits. Green: all66 added cases and252 focused discovery regressions pass. Coverage includes both route kinds, all-four input and64x128-character parameter bounds, partial-capability exclusions, reverse order/no-match, exact unknown/all tokens, output union with all eight paging/filter fields, filter-only501 matches, authentication, model/provider/implicit/explicit Deny and fresh continuation IAM, whole-catalog/required audit failures, captured metadata mutation and sanitized records. Eleven added successful requests use installed OpenRouter1.4.18/OpenAI7.23.0 sockets for intersections, retained iteration and current provider denial. Obsolete comma-rejection fixtures are replaced with malformed/unknown cases.

Official reference/schema permit comma strings. Credential-free complete fixed-host observations for image/file and tools/temperature or tools/structured_outputs in both orders equal singleton intersections and every returned row contains all requested members. AND is empirically supported local semantics, not encoded in the plain-string structural pin. Local uniqueness/input vocabulary/64 metadata capacity and exact unknown-parameter handling remain explicit restrictions; upstream ignores some unsupported tokens and accepts duplicates. No live capability or complete compatibility certification follows. All three source pins remain byte-identical. Metadata freshness, selected-provider capability, remaining discovery fields, broader client workflows, full #116 and unresolved #7 remain open. Current catalog/policy can shift offset pages without snapshot guarantees. Listing still invokes no inference, route, secret, limit or usage ports.


Full npm run check passes strict types, lint, 5661 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
