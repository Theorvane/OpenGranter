# Compatible model-list paging

Only GET /api/v1/models accepts singleton offset/limit alongside the bounded [discovery filters](model-discovery-filters.md). Decoded paging values must be canonical unsigned decimal safe integers: offset>=0, limit1..1000. Missing values default to offset0/limit500 when either paging field is supplied. Both omitted retain the full current matching list. Null SDK offsets serialize as omission; literal query null, duplicates, blank values, signs, fractions, exponents, leading zeros and unknown filters reject before catalog reads with safe invalid-request audit. /v1 continues rejecting every nonempty query.

The gateway authenticates and validates the complete current catalog before filtering enabled aliases through model AND final-provider IAM. Only then does it apply supplied discovery predicates and optional [search/order extension](model-discovery-exploration.md), then slice the matching sequence; omitted sort retains trusted catalog order. Denied/disabled/nonmatching aliases do not consume offsets, appear in total_count or enter continuation links. Malformed out-of-page or denied entries still invalidate the whole catalog. No partial availability is inferred.

The compatible response contains the selected data, total_count for all currently visible matching aliases, and links.next. Continuations are fixed relative /api/v1/models?offset=<next>&limit=<limit> URLs, preserving accepted discovery filter/search/order fields when supplied; no incoming host, arbitrary filter or source metadata can control the destination. Next is null for unpaged full lists, exhausted/empty pages or offsets beyond the matching end. Required models-listed audit records the returned count before delivery. Existing metadata capture, audit failure, no-secret/no-limit/no-inference/no-usage controls remain shared.

Actual SDK 1.4.18 iteration is tested with explicit limits/defaults/null offsets, exact page multiples and a 501-model no-argument response. The SDK advances by returned count rather than links.next/total_count; exact multiples and large unpaged initial results can require an additional empty request, which is supported. Unconfigured metadata retains its existing SDK schema gap.

Every page reevaluates current authentication/IAM/catalog. Catalog or policy changes can shift offsets, causing repeated/missed aliases; no cross-request snapshot or cursor guarantee is made. Remaining filters/sorts/count endpoints, metadata freshness and complete external-client conformance remain separate gates. See [plan](../docs/plans/230-model-list-paging.md).

## Filter extension (#456)

The [discovery filter contract](model-discovery-filters.md) now adds output_modalities/supported_parameters/context queries (output union and all-member input/parameter lists extend this under #472/#474). Apply captured metadata predicates after IAM and before paging; matching authorized totals/continuations preserve accepted filters. Unknown and broader filters remain rejected. Filter-only requests retain full-list behavior.

Issue #460 adds bounded input/search/order fields before paging. Next links retain those fields and SDK continuation reevaluates current IAM; see [exploration contract](model-discovery-exploration.md).
