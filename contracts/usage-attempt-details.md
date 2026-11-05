# Usage attempt details

The usage table has an Attempt details column with native details/summary per existing authorized record. It exposes request ID, attempt ID, route kind, upstream model, selected candidate, actual inference provider, latency, prompt/completion token counts, estimated price version and reported billing source. Null fields display Unknown; zero stays zero and decimal amount strings remain exact. Existing table cost/availability/possible-duplicate flags remain unchanged. No success or reconciliation status is inferred from identifiers or flags.

Use textContent only. Do not display credential IDs, policy versions, raw JSON, prompts, token strings or unknown record properties. No extra API call, stored identity, privilege or retention is added. Detail DOM is removed with its parent row on new reads, authorization failure, identity clear and disposal. Expansion is native local presentation, not an API authorization grant.

Plan: [642](../docs/plans/642-usage-attempt-details.md). Structural DOM tests are not authenticated browser acceptance.
