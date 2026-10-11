# Informational model benchmarks

Issue #482. Plan: [482-model-benchmark-metadata](../docs/plans/482-model-benchmark-metadata.md).

Complete snapshots may supply own optional non-null benchmarks. Own design_arena is required and contains 0..64 non-null rows. Each row requires own arena/category strings (0..256 UTF-16 units), finite numeric elo/win_rate and signed safe-integer rank. Optional own non-null artificial_analysis requires all three own intelligence_index/coding_index/agentic_index fields, each finite number|null. Preserve exact text, numbers, empty arrays, duplicate rows, order, null and omission; no score/rate normalization, rank-range assumption or deduplication.

Own undefined, null objects, incomplete/unknown shapes, invalid/nonfinite values, unsafe/fractional ranks, holes (even with inherited fillers) or overlong/oversized values fail the entire snapshot with fixed errors. Capture the array length and own indexed/nested fields once without invoking supplied iterators; freeze all objects/arrays before asynchronous handoffs. Inherited optional properties are omitted; thrown getters stay private.

Only enabled model AND final-provider IAM-authorized aliases expose benchmark data on GET /api/v1/models after complete hidden-catalog validation, existing filters/order/paging and required private audit. Each page reevaluates policy; basic/legacy rows stay unchanged. No benchmark data enters operational errors/events. Listing calls no inference/routing/secret/limit/usage ports. New fields do not expand existing search/capability/sort predicates or change alias identity/routes.

Benchmarks are administrator-published source-relative information, not correctness/freshness guarantees, provider rankings or authority to choose/authorize an endpoint, estimate tokens, set limits or establish billed cost. No benchmark API fetching, aggregation, refresh or management publication is added.

PostgreSQL listing/route resolution shares validation and deeply frozen capture while retaining approved routes. Existing nullable JSONB object/64 KiB cap remains with no migration/backfill; otherwise individually valid field limits may exceed that aggregate storage cap. Downgrading requires removing the newly supported key.

OpenRouter 1.4.18 maps artificialAnalysis/designArena and intelligenceIndex/codingIndex/agenticIndex/winRate; OpenAI 7.23.0 preserves raw extra fields despite narrower Model types. Public/storage/SDK cases cover success, Deny, failures, values/bounds and mutation. All three pins remain unchanged. Local bounds, own-required and unknown-key restrictions are not source guarantees. Remaining fields, publication/refresh, full #116 and unresolved #7 stay open. Sources: [official schema](https://openrouter.ai/openapi.json), [models reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).
