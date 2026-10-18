# Benchmark model discovery order

GET /api/v1/models accepts `sort=intelligence-high-to-low`, `coding-high-to-low`, `agentic-high-to-low` and `design-arena-elo-high-to-low`. The first three use the corresponding `benchmarks.artificial_analysis` index; the fourth uses the maximum `elo` across all published `benchmarks.design_arena` rows, without selecting an arena/category or consulting `rank`/`win_rate`.

Sort matching authorized aliases descending by that captured finite score before paging. Zero, negative and extreme finite numbers are valid; absent metadata/index, null index and empty arena rows have no selected score and sort after every known score. Equal scores and absent scores preserve trusted catalog order. Omitted sort preserves the existing order. Stable ties are a local choice, not an upstream snapshot-consistency guarantee.

The whole catalog is validated before enabled/model/final-provider IAM and existing filters. Malformed hidden/disabled/out-of-page entries fail the request privately. Paging retains every accepted query field in a fixed relative continuation; each request reloads state and permissions. Current total_count includes only matching authorized aliases. Required audit precedes output and contains no benchmark/query values. Listing does not call provider, route, secret, limit or usage ports. Deeply captured metadata prevents audit-time mutation from rewriting the order or response.

Malformed/duplicate/case/whitespace/unsupported sort values reject before catalog reads after authentication. Legacy /v1 rejects these nonempty queries. Existing default/newest/context order, storage and source pins remain unchanged. The registered scores are informational and can be stale or inaccurate; ordering does not rank inference candidates, grant IAM, certify capabilities, fetch benchmark sources or calculate cost.

Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), /models sort parameter, checked 2026-10-18. Installed OpenRouter1.4.18/OpenAI7.23.0 socket tests cover the selected modes; full #116 and unresolved #7 remain open.
