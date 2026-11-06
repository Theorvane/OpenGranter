# 640: Explicit SSO management workspace HTTP composition

1. Preserve the existing read-only review factories and all their rejection behavior.
2. Add a separately named, source-only management workspace handler and unbound server. Compose the existing registered-key SSO catalog/usage handlers and token issue/revoke handler. Capture the six shared configuration fields once; do not accept injected authentication, authorization or audit overrides.
3. Dispatch only the two exact POST token paths; pass the original Request unchanged. Delegate all other requests to the read-only review handler. Child validation, fresh authentication/bindings/IAM, lifetime caps, mandatory decision audit and atomic lifecycle writes remain authoritative.
4. Prove RED/GREEN with signed RFC9068 test access tokens, migrated PGlite and actual loopback HTTP: issue, verify digest, revoke, current Deny, rejected authentication, failed mandatory audit, lifetime rejection, route/query/method isolation, read-only regression and unbound construction.
5. Run focused integration tests, typecheck, lint and contract checks; request exact-head independent review and CI. No merge without formal approval and all required CI.

## Boundaries

This does not activate a listener, migration, installed runtime, browser entry, session/BFF/cookie adapter, CORS/CSRF contract or SSO audit-history bridge. Existing read-only factories remain read-only. Deployment/schema/SSO/session approvals remain required. A write with a lost response can have committed; no automatic retries or reconciliation claim. Test signing keys/tokens remain in memory.

Contract: [management-workspace-http](../../contracts/management-workspace-http.md).
