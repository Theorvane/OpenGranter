# Explicit same-origin administration browser composition

Refs #637 / #640; [plan](../docs/plans/637-administration-browser.md).

createPostgresSsoAdministrationBrowserHandler/Server is an explicit source-only alternative to the unchanged read-only review factories. The server is unbound. It serves the existing public static shell and caller-supplied public artifact plus existing registered-key SSO reads and credential mutations on one origin.

- Exact POST /management/v1/proxy-tokens and /management/v1/proxy-tokens/revoke dispatch unchanged to existing credential management. Fresh authentication precedes validation, current iam:Manage and owner caps remain enforced, and mandatory decision/lifecycle audit and atomic credential writes retain existing behavior.
- Other requests delegate unchanged to the read-only review handler: exact GET current principal, model list/encoded detail and scoped usage JSON/CSV. Unknown paths and methods are no-store/nosniff 404. No trailing-slash mutation aliases, credential inventory endpoint, inference route, method override or SPA fallback.
- Public static routes retain CSP, no-store, framing and method checks without SQL, authentication or Set-Cookie. A public artifact is not permission to read or mutate. Cookie-only requests cannot authorize a credential operation.
- The shared configuration is captured once. Child factories remain responsible for registered issuer/audience/keys, live bindings, IAM and concrete mandatory audit. Callers cannot inject a no-op audit or fake authentication port.
- The Node bridge uses fixed 503/internal_error with no-store/nosniff on adaptation failure; no private request/body/error projection.
- Existing read-only factories and all runtime defaults stay unchanged. This factory does not bind, open/close a database, migrate/promote schemas, select ingress, supply session/CSRF/CORS policy, inject/persist bearer tokens, acquire browser authority or call providers.

Caller must own reviewed SQL/schema lifecycle, public build provenance, explicit listen/TLS/ingress and any separately approved authority adapter. Existing candidate usage-audit schema needs its own review/promotion; composition is not installed activation. Existing mutation ambiguity/reconciliation and one-time secret constraints remain unchanged.

## Acceptance evidence

The management-administration-http-integration test runs source and built public workspace against actual same-origin loopback HTTP, signed test SSO and migrated PGlite without stubbed catalog/identity HTTP. Models/Account and confirmed issue/revoke retain fresh Deny and failed-audit rollback, no secret in audit and host-lifetime ambiguity latch. Boundary cases verify public SQL isolation, exact allowlist, unchanged read-only writes rejection, cookie rejection before malformed body validation, required anonymous audit failure and Node adaptation error.

These are local source/build/HTTP/database checks, not native-browser, company IdP, installed PostgreSQL, deployment or paid-provider acceptance.

## Explicit dedicated Account audit integration (#778)
An own principalAuditClient option on the existing review/browser and administration ports selects the reused #777 current-principal handler for exact GET /management/v1/me. Success remains {principalId}; its dedicated audit append is awaited on success/denial/failure. The option is captured once. An explicit undefined, null or invalid client fails construction rather than falling back. Absence (including inherited properties) preserves the legacy management identity behavior and default schemas. Static, catalog/usage and credential dispatch remain unchanged; /management/v1/principal is not added to the review allowlist. No callback audit override is exposed by these compositions.

Caller owns an explicitly reviewed/installed contracts/sql/current-principal-audit.sql table and committed/autocommit audit client; no default migration promotion, schema approval, exactly-once guarantee, session, authority acquisition, runtime activation or provider call follows. Existing credential writes retain fresh IAM and their original mandatory transaction/audit. Dependency identity/audit source is adopted from exact #77703b78979cbcef6bb59314570778e778900dd33b8; this integration requires its own new exact-head CI and independent formal review before adoption or merge.

## Catalog landmark integration (#637 / #639)
The public shell owns the document main landmark. The catalog renderer is a named Model catalog section, never another main, across loading, empty, list, detail and failure states. Heading focus and native controls remain unchanged. This applies to source and restricted browser builds; it does not change authentication, routes or the public entry. See the integration follow-up in [plan](../docs/plans/784-audit-page.md).
