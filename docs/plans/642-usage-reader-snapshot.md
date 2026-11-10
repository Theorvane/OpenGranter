# Stable usage reader request ownership (#642)

1. Capture the authorized principal, limit, request/model/time filters and a copy of the nested cursor before the first SQL await. Validate and use only that owned request for SQL parameters and all returned-row checks.
2. RED: hold the production reader at its SQL port. Mutate caller-owned principal, filters, limit and nested cursor; demonstrate false failures and acceptance of substituted rows under the old implementation.
3. GREEN: preserve original request semantics, including hidden lookahead and descending keyset checks. Reject rows outside the original scope even if caller objects change. Test concurrent independent requests and real PGlite SQL execution.
4. Run reader, public SSO/API and filtering regressions, typecheck, lint and documentation checks. Submit an isolated backend PR based on #760; require exact-HEAD CI and independent formal approval before merge.

This fixes the usage review API dependency for original PRD review/isolation requirements. It does not add authority, change policy, enable browser sessions, deploy schema or claim installed/provider acceptance. Session/BFF files remain unchanged.
