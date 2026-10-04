# Chat probability source selection

Issue #422. Plan: [422-logprob-schema](../docs/plans/422-logprob-schema.md).

Version 20 adds exactly ChatRequest.logprobs/top_logprobs to the selected fields and whole ChatTokenLogprobs/ChatTokenLogprob to responseDefinitions. Counts become 25 fields/five response definitions; all previous selections remain. ChatChoice/ChatStreamChoice references continue to point to the same group definition, while nested token/refusal/content/bytes/alternative/required structure now causes drift independently.

Track source type/nullability/reference/format/constraints/required/default/extension structure, including inline alternative objects. Editorial annotations remain ignored, but annotation-named properties and literal default/example-named payload keys remain data. Missing/malformed root containers and selected fields/definitions, stale versions and rehashed invalid exact maps reject safely. The guard checks structural projections, not JSON instances or semantic correctness of a malicious recomputed pin.

The source request has nullable boolean logprobs and nullable integer top_logprobs without machine-readable 0..20 or dependency constraints. Group content is required nullable, refusal optional nullable; each token requires token/logprob/bytes/top_logprobs and alternatives require token/logprob/bytes. Bytes have nullable integer-array structure without machine byte bounds; logprob is a double number without sign limits. Preserve these facts. The separate [runtime contract](nonstream-logprobs.md) defines local supported checks.

Refresh requires reviewed canonical full-source/projection SHA-256 provenance. The explicit fixed-host live command never auto-updates files, sends credentials or enables a request path; failures remain fixed messages. Native/stream mappings, model capability guarantees, full instance validation and #116 remain open.
