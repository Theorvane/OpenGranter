# Usage JSON cost comparison (#642)

1. Expose the merged exact metadata comparison on authorized JSON usage rows for the management cost screen, using the same projection as CSV.
2. Keep stored schema and original validated fields unchanged. Never trust an injected comparison or redisplay unknown fields. JSON decimal deltas remain strings, including negative values; no CSV apostrophe in JSON.
3. Test unknown, one-source, mismatch, exact tiny differences, negative delta, duplicate flags and invalid records. Prove actual signed-SSO durable Fetch and proxy history responses, scope and mandatory-audit failure gates.
4. Run RED before implementation, GREEN/regressions, typecheck and checks. Require exact-HEAD formal review and all CI before merge. No UI/session/DDL/IAM/runtime activation, provider or deployment claims.
