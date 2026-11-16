# Account trusted-session lifecycle (#639)

1. Consume only an existing caller-owned CatalogAuthorityGrant, never acquire credentials or approve BFF/OIDC. Add an opt-in Account lifecycle without touching shell/entry/navigation.
2. Start locked; authorize replaces identity synchronously. Enforce absolute expiry through headers and streamed body reads, including delayed timer delivery. Clear/dispose abort the Account client and remove identity.
3. RED tests cover no initial request, successful identity, expiry, logout, replacement with late response, missed timer during body consumption, denial, invalid clock/scheduler. Implement using the established operations-session contract.
4. Verify with the real owned HTTP + signed synthetic JWT + embedded PostgreSQL composition; distinguish that evidence from real IdP/deployment. Run focused regressions, full typecheck and changed-file lint.
5. Require exact-head CI and independent formal approval before merge. No schema, runtime activation, deployment or paid calls.
