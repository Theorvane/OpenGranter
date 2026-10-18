# Exact base-price model discovery order

GET /api/v1/models accepts `sort=pricing-low-to-high` and `sort=pricing-high-to-low`. Compare the exact sum of captured base `pricing.prompt` and `pricing.completion` strings: dividing every sum by two would produce the same equally weighted mean order. Do not round, use floating-point price arithmetic, derive a total charge, apply discounts/conditional overrides or include other price components.

Use the existing validated nonnegative decimal/scientific syntax and 128-unit bounds. Preserve order across very precise fractions, equivalent decimal/exponent spellings, carries, tiny positive values whose Number conversion underflows and sums whose Number conversion would overflow. Sparse decimal digit positions use bounded-size BigInts rather than allocating zero runs or powers of ten proportional to exponent magnitude. Per-request immutable sum keys may be cached; no cache survives the request.

Known zero is a free base-price pair, not missing data. Aliases without metadata sort last in either direction; equal sums and missing entries preserve catalog order. These missing/tie rules are local, not an upstream snapshot consistency claim. Original price strings and metadata remain unchanged in responses.

Complete catalog validation and enabled model/final-provider IAM precede filtering/order/paging. Malformed hidden/disabled/out-of-page prices fail privately. Combined filters and fixed relative continuations retain all selected fields; each page reloads state and policy. Required audit precedes output without query/price values in operational events or errors. Listing invokes no inference/secret/limit/usage ports, and audit-time source mutation cannot change captured order or output.

Malformed/duplicate/case/whitespace sort variants and unsupported modes reject after authentication but before catalog reads. /v1 nonempty queries, existing sort modes, migrations and all source pins retain their behavior. Administrator pricing can be stale/inaccurate; this does not select providers, certify capabilities or calculate billed/estimated request cost.

Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), /models sort description, checked 2026-10-18. Both literals are already selected by model-query pin v2. SDK fixture conformance is bounded; full #116 and unresolved #7 remain open.
