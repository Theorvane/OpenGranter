# 642 Usage cost comparison in exports

1. Preserve scoped authorization, durable access audit, pagination, usage/duplicate markers and raw cost columns.
2. Add a pure metadata projection and append comparison status, reported-minus-estimated decimal and currency columns to existing CSV. This is not invoice reconciliation or paid-budget authorization.
3. Missing costs remain unknown; different currencies are not converted. Compare same-currency amounts with exact bounded decimal integer arithmetic, never Number rounding. Preserve original amounts, version and source.
4. Before implementation run failing acceptance cases for exact decimals, unknown costs, unequal currencies, equal/above/below estimates, zero, large values, malformed input and CSV integration. Then run existing export/SSO regression tests, typecheck and repository checks.
5. Submit main-based PR. Require exact-head independent formal approval and all mandatory CI before merge. Browser/session/installed/provider evidence remains separate.
