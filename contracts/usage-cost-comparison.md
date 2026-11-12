# Usage cost comparison (#642)

Existing CSV columns retain their order and meanings. Append `cost_comparison`, `reported_minus_estimated`, `comparison_currency`.

- `unknown`: neither amount exists; `estimate_only` and `reported_only`: only that source exists.
- `currency_mismatch`: both exist with unequal exact currency codes. No exchange conversion, delta or comparison currency.
- `equal`, `reported_above_estimate`, `reported_below_estimate`: both amounts exist in the same currency, compared exactly. Delta is reported minus estimated, canonical signed decimal with insignificant trailing fractional zeros removed. Zero is `0`.
- Non-comparable rows have blank delta/currency. Original cost fields, missing token status, possibly-billed and possible-duplicate remain independent. Equal does not mean reconciled or invoice verified. Provider reporting is not proof of final billing.
- Same validated usage metadata, existing scope and mandatory audit apply. No secrets, bodies, runtime/session/IAM/DDL changes or provider calls. Malformed input rejects the whole export; no partial success.
- Existing spreadsheet formula mitigation applies to all strings, including a negative delta (which receives an apostrophe in CSV). This changes representation, not numeric meaning; machine consumers should use the pure projection or original cost columns.

## Authorized JSON rows (#642)

Existing proxy usage-history and signed-SSO usage JSON rows append `costComparison` with `status`, `reportedMinusEstimated`, and `currency`, using the exact CSV comparison semantics. Non-comparable values are JSON null; delta is a decimal string, with no spreadsheet apostrophe. Original cost source/version, token availability and duplicate/possibly-billed flags remain independent. Unknown extra stored fields (including a forged comparison) are discarded and comparison is recomputed. Existing principal filters, keyset pagination, mandatory audit and unavailable withholding remain unchanged. No new endpoint, persistence or authority. Existing browser client may ignore this additive field; this change does not claim rendered UI.
