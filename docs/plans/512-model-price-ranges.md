# Filter discovery by exact advertised price ranges

## Issue and problem

- Issue: [#512](https://github.com/Theorvane/OpenGranter/issues/512), part of #116.
- External clients can sort advertised base prices but official prompt/output price range queries currently return 400.

## Scope and expected behavior

- Support inclusive min_price/max_price and min_output_price/max_output_price on GET /api/v1/models, expressed in USD per million tokens. Filter exact advertised per-token prompt/completion strings; exclude basic aliases without pricing when any bound is supplied.
- Accept nonnegative finite decimal/scientific strings up to 128 UTF-16 units with the existing canonical unsigned mantissa syntax. Preserve spelling in relative continuations and exact comparison even below numeric underflow. Reject malformed, duplicate or exactly reversed pairs after authentication and before catalog access. These syntax/length restrictions are local.
- Compose with current filters/sorts/paging; validate/capture the full catalog, apply complete model/final-provider IAM, and require private audit. Keep legacy/count queries unchanged. No provider, secret, inference, limit or usage calls; do not apply discounts, overrides, optional charges or billed-cost calculations.
- Advance query pin v3 to v4 by adding four complete official parameter objects. Preserve earlier selections and every other pin unchanged.

## Design

- Reuse sparse base-10 digits and BigInt positions from exact price ordering. Generalize its digit construction to single or paired prices and a fixed decimal position shift. Compare query bounds directly to detect reversed pairs, and shift per-million bounds by minus six positions for per-token comparison. Never multiply a Number, expand exponent-sized zero runs or coerce accepted query strings for continuation serialization.
- Capture immutable price range objects in the query parser. Prepare request-local bound keys once, then filter captured authorized metadata before sorting/paging. Omitted bounds preserve existing discovery behavior.
- The [official OpenAPI](https://openrouter.ai/openapi.json), inspected 2026-10-18, defines four optional nonnegative number/null query schemas and USD per million prompt/completion semantics. The query pin records raw structures; local decimal restrictions and exact stable comparison are separate runtime rules.
- Extend [contract](../../contracts/model-price-ranges.md), query/schema contracts, PRD, architecture, acceptance and compatibility notes. This extends the existing advertised-price concept; no glossary or ADR change is needed.

## TDD plan

- First write raw and installed OpenRouter/OpenAI SDK cases and record expected unsupported-query 400 failures before production changes.
- Cover four inclusive/one-sided/zero bounds, exact 10^6 unit conversion, precision beyond Number, huge/underflow exponents and zero, independent bounded integer comparisons, ignored discounts/overrides and absent metadata.
- Verify combined filters/sorts and relative continuation spellings, fresh policy/catalog reads, model/provider Deny and implicit Deny, auth ordering, malformed hidden data, catalog/audit failure, snapshot mutation and content-free metadata/errors. Count and legacy queries reject the new fields.
- Extend independent query-pin shapes, each new structural constraint, stale/rehashed maps, prior-digest reconstruction and controlled CLI drift. Run focused regression suites, fresh four-pin official comparison and npm run check.

## Delivery

- Commit with the authorized identity, Assisted-by and DCO trailers; open a ready plan-linked PR and require current-head approval and CI.
- Risks: published prices may be stale/inaccurate and do not establish a request bill. SDK numeric serialization limits precision before the gateway receives a query; raw query strings preserve supported exact values. Remaining discovery, full #116 and unresolved #7 remain open. Rollback restores paired query validator/pin and runtime filter changes together.

## Verification evidence

- Red: the initial raw/installed SDK suite ran 13 cases with 12 expected unsupported-query failures and one existing invalid-query pass. Independent query-schema tests against the v3 implementation ran 92 cases with 19 expected missing-selection/version/drift failures.
- Green: eight focused raw/SDK price-order/price-range/benchmark-range/query-schema/controlled-CLI suites passed all 168 cases. Coverage includes an independent integer oracle and exact tiny equality across a 100-digit exponent.
- Test setup corrections: listing does not currently promise the count endpoint's no-store header, so that incidental assertion was removed; a combined benchmark fixture was completed with its required three indices. No product cache policy or metadata validation was changed to satisfy those fixture mistakes.
- Fresh query pin source SHA-256 e14bcc1e02453bff8807cc79d03170ce7d229a9d0836e253ff49b764b8aa811d; projection SHA-256 aa9f1298d0c56d6d786499f859c3ee9062b2bc01407e2c9926bff1e85921ff62. Request/response/count pins have no diff from main. Full gate and live comparison results are recorded before delivery.
- Fresh fixed-host live comparison passed all four subsets. Initial full gate reported zero assertion failures but one existing direct gateway shutdown timeout at its unchanged 15-second deadline under host contention. The unchanged complete postgres-gateway-runtime suite passed all 19 cases in isolation. A clean full-gate retry follows; no timeout, warning suppression or production runtime lifecycle change was made.
- Clean `env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` retry passed: 6,877 cases, 6,876 passed, one optional external PostgreSQL skip, zero failures/cancellations. Strict types, lint, planning/link/contract/fixture-secret checks and all four offline integrity checks passed. Evidence: /tmp/opengranter-512-check-retry.log; isolated runtime evidence: /tmp/opengranter-512-runtime-recheck.log.
