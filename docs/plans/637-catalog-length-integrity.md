# Catalog response length integrity (#637/#639)

1. Reproduce complete-looking list/detail JSON accepted despite mismatched Content-Length in both explicit transports.
2. Compare received UTF-8 bytes to decimal declared length for identity encoding before JSON publication. Preserve compressed Fetch decoded bodies, absent lengths, cancellation and status-only errors.
3. Run RED/GREEN cases for short/long/exact multibyte bodies, zero length, absent length, compressed responses and denied responses; run catalog regression, typecheck and lint.
4. Require exact-head required CI and formal approval before merge. No authentication activation, deployment or provider calls.
