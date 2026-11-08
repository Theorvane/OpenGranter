# Current principal in same-origin read-only review (#639)

1. Reuse #668 current-principal authentication in #722 review composition; no new authenticator, session, schema, listener activation or writes.
2. Dispatch only exact GET /management/v1/me. Keep token issue/revoke unreachable; authenticate before query validation. Cookies never grant authority. Identity is not catalog permission.
3. Demonstrate missing-dispatch RED then GREEN actual loopback signed-JWT/embedded-SQL identity, revocation, required denial audit and outage, static isolation and no writes. Not browser login, installed PostgreSQL or company IdP acceptance.
4. Run focused regressions, typecheck and lint. Require exact-head CI and independent formal approval; land parent dependencies first.
