# Account trusted-session lifecycle (#639)

1. Consume only an existing caller-owned CatalogAuthorityGrant, never acquire credentials or approve BFF/OIDC. Add an opt-in Account lifecycle without touching shell/entry/navigation.
2. Start locked; authorize replaces identity synchronously. Enforce absolute expiry through headers and streamed body reads, including delayed timer delivery. Clear/dispose abort the Account client and remove identity.
3. RED tests cover no initial request, successful identity, expiry, logout, replacement with late response, missed timer during body consumption, denial, invalid clock/scheduler. Implement using the established operations-session contract.
4. Verify with the real owned HTTP + signed synthetic JWT + embedded PostgreSQL composition; distinguish that evidence from real IdP/deployment. Run focused regressions, full typecheck and changed-file lint.
5. Require exact-head CI and independent formal approval before merge. No schema, runtime activation, deployment or paid calls.

## 2026-11-18 exact-head review correction

Independent review of 87d1358 and both required Checks reproduced TS18046 in the new ordered audit assertion: the unparameterized embedded PostgreSQL query exposes unknown rows. Type this existing SELECT result explicitly with an outcome string, preserving the ordered durable-audit assertion and production behavior. Re-run focused tests, lint and typecheck; new-head CI and independent formal approval are still mandatory. This is a test type correction, not a session or schema contract change.
