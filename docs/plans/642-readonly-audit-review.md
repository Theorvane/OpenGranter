# Read-only review audit API (#642)

1. Close the missing audit route in the existing read-only review HTTP/browser composition using the concrete signed-SSO, fresh IAM and durable SQL access-audit handler.
2. Require explicit auditHistoryClient opt-in; omission preserves 404. Reject invalid explicit clients at construction, including undefined. Do not enable writes, sessions, schema migration or installed listeners.
3. Prove missing-route RED, then SQL/JWT/loopback HTTP JSON and CSV isolation, each-page reader audit, later denial and audit-store failure. Verify legacy default and write rejection.
4. Run typecheck, scoped lint, existing review/administration suites and planning checks. Request exact-HEAD formal review and required CI; do not merge before gates. Browser and installed acceptance remain separate.
