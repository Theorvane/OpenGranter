# Canonical current-principal integration (#637, #639)

1. Reuse the existing PR769/771/775/777 identity-only Account contract on canonical main. Preserve exact GET /management/v1/me {principalId} and /principal {id,kind}; this is not a login or session grant.
2. Prove canonical composition currently returns 404 for a signed registered human using migrated local SQL and the explicitly installed test-only audit contract.
3. Port the bounded authenticated handler and hardened audit writer. Provide a canonical factory with one owned-by-caller SQL client and mandatory durable audit, no callback override. Add exact routing to the existing canonical read composition only.
4. Preserve fresh issuer/subject binding, no implicit IAM permission, no-store/nosniff, bodyless GET validation, awaited audit before disclosure, anonymous authentication failures, and fail-closed missing/invalid audit acknowledgements.
5. Verify actual Node loopback HTTP Account payload, active binding revocation, denied model access, unsupported paths, malformed requests, audit failure and pending audit. Run isolated SQL tests, unit regressions, full typecheck, changed-file lint, script checks and offline compatibility.
6. Submit a draft PR; require exact-head required CI and independent formal approval before merge. Existing predecessor PRs are historical source, not approvals. No runtime/session/DDL/migration/listener activation, provider calls or paid budget.

## Acceptance / boundaries
- The SQL audit definition is an explicit opt-in contract copied from prior work, not added to migrations. Missing table returns audit_unavailable and no identity. Production schema approval/install remains blocked independently.
- Canonical /me projection is exactly one principalId property; /principal remains two fields. No access token, issuer, subject, policy, secret or proxy credential is disclosed.
- Local signed JWT + embedded SQL + HTTP is not browser/IdP login, installed PostgreSQL, TLS, deployment or live-provider acceptance.
