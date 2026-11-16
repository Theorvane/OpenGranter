# Account to token issuance preparation (#640)

1. Add executable RED cases for exact validated Account identity handoff, explicit review/confirmation, stale actions, denial and disposal.
2. Add an opt-in Account action and route its captured ID into the existing token form, without fetching or posting on navigation. Clear prior Account DOM and invalidate detached controls.
3. Keep principal editable and expiry blank. Reuse existing validation, review, explicit POST, server IAM/lifetime/audit, one-time secret and revocation flows. A handoff is not an authorization grant.
4. Exercise real owned Node HTTP + signed synthetic RFC9068 access token + migrated embedded PostgreSQL: Account read, issue, fresh Deny, audit failure. Distinguish synthetic local acceptance from visible browser/installed/provider evidence.
5. Run bounded regressions, typecheck, lint and planning validation; publish a draft PR. Merge only with exact-head required CI and valid independent formal approval.

No session acquisition, IdP/CSRF contract, endpoint, IAM action, schema, bootstrap, deployment or paid calls change. Existing owner worktrees remain untouched.
