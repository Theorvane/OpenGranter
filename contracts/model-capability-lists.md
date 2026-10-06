# Authorized all-member capability filters

Issue #474. Plan: [474-model-capability-lists](../docs/plans/474-model-capability-lists.md).

GET /api/v1/models accepts input_modalities as one comma string of one to four distinct exact text/image/audio/file values, and supported_parameters as one comma string of one to64 distinct lower_snake_case identifiers of1..128 characters. Require every requested input and every requested parameter in immutable administrator-published metadata. The64 bound matches published metadata capacity. Unknown valid parameter identifiers and all remain exact identifiers, never ignored or wildcarded; input all remains unsupported. Missing/empty metadata cannot satisfy asserted lists.

Reject empty/duplicate/unknown-input/case/whitespace values, excessive bounds and repeated query keys before catalog reads. These are explicit local syntax restrictions. Preserve the [output union](model-output-filters.md), standalone output all, omitted-filter full lists without an implicit text default, conjunction across fields, literal search, stable ordering, paging defaults/bounds and legacy /v1 query rejection.

Validate the entire catalog, then enabled model AND final-provider IAM, before all-member matching and optional order/paging. Hidden/disabled/malformed records retain whole-catalog validation; denied aliases never contribute matching totals or offsets. Fixed relative continuations join captured lists as single encoded query values, retaining their requested order and every accepted field. Each page independently authenticates and reevaluates current catalog/IAM; there is no snapshot guarantee. Filter-only lists above500 remain complete.

Required sanitized audit precedes delivery. Errors/events exclude filter values and private metadata. Listing calls no inference, routing, provider-secret, limit or usage ports. Response metadata and matching survive audit-time source mutation. Matching cannot grant invocation rights or guarantee any selected provider's live capability.

Public and installed OpenRouter1.4.18/OpenAI7.23.0 socket regressions verify intersections, combined output union, scalar serialization, paging and fresh Deny. Existing three pins remain byte-identical. Other discovery queries, metadata refresh/provisioning, broader workflows, full #116 and unresolved #7 remain open.

Sources checked2026-10-06: [official reference](https://openrouter.ai/docs/api/api-reference/models/get-models), [official schema](https://openrouter.ai/openapi.json). The reference documents comma strings; complete credential-free official models responses for image/file and tools/temperature or tools/structured_outputs pairs in both orders equal the singleton intersections and contain every requested member. AND is empirically supported local semantics, not a schema-encoded promise. Upstream duplicate/unknown/all behavior is more permissive; local uniqueness/vocabulary/exact matching and finite bounds are not fabricated in the structural pin.
