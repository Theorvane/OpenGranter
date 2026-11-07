# Credentials host integration (#637 / #640)

- Reuse 62fd372 token-management client/authority/workspace/app snapshots and only 15696c5 token host delta; do not import audit or other branch ancestry. Frontend owns the component modules; coordinator owns narrow composition and HTTP acceptance.
- Existing POST /management/v1/proxy-tokens and /management/v1/proxy-tokens/revoke remain the only mutation routes; trusted request-port authority is not a login or browser session contract.
- Exact-target confirmation; server validates current IAM and audits transactionally. Token is shown once in volatile owning workspace only; no persistence, analytics, or raw error projection. Navigation hides it; stale controls cannot consume new grants.
- Pending/ambiguous outcomes remain blocked for the host lifetime. Grant renewal, logout and view navigation cannot reset the latch. A fresh page is NOT a reconciliation mechanism; cross-tab/reload reconciliation remains an unresolved server contract.
- Required gate: source and public build tests, signed test JWT, migrated PGlite, real mutation HTTP, successful verification/revocation, private audit, fresh IAM denial and audit failure rollback; all ancestor review/CI gates remain mandatory.
- No new authority, endpoint, credential inventory read permission, schema promotion, runtime deployment or provider activation.
