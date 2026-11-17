# Explicit canonical operations composition

The new `createPostgresSsoCanonicalOperationsHandler` / `createPostgresSsoCanonicalOperationsServer` factories combine canonical Account, Models and scoped Usage/Audit reads with existing POST `/management/v1/proxy-tokens` and POST `/management/v1/proxy-tokens/revoke`. The server is returned unbound. No CLI, installed service, default factory or production listener changes. The previous canonical-review factory remains read-only.

## Configuration and authority
Use the same trusted registered issuer/audience/JWKS/time, request-ID generator and committed/autocommit SQL client as the existing compositions. Only an explicitly supplied trusted public JavaScript artifact enables the public shell. No callback authentication, audit or issue override is accepted. The shell is not login: acquire a human RFC9068 access token through the separately approved SSO boundary. Cookies and proxy tokens are not management authentication. No CORS grant or cookie is emitted.

## Data dependencies
The caller must explicitly install existing migrations and the separately managed `contracts/sql/current-principal-audit.sql` prerequisite for Account. Factories never install DDL, commit caller transactions or own database lifetime. Missing prerequisites fail closed, not with fabricated identity. This composition does not approve that schema for deployment.

## Acceptance
- The same loopback socket serves Account, Models and principal-scoped history and existing token mutation endpoints. Exact paths only; unknown endpoints remain private404 and no gateway calls are mounted.
- Fresh `iam:Manage` on the existing target and existing maximum-lifetime/transaction/audit gates are preserved for each issue/revoke. Identity is not a grant. Mutation responses and errors are no-store/nosniff.
- Successful issue yields the existing one-time token. Successful revoke immediately invalidates it; repeated revoke retains the existing false result. No secret logging or new storage.
- Fresh Deny blocks issue/revoke; revoked human binding fails authentication; missing bearer or a proxy token cannot impersonate a human. Mandatory audit failure returns no secret and rolls back both issuance and revocation.
- Tests use synthetic signed JWTs and migrated PGlite over loopback. They are not real IdP/browser-login/native PostgreSQL/installed-provider E2E.

Rollback: keep selecting the existing canonical-review factory. No new policy, session/CSRF/CORS contract, schema, retention, paid call or runtime activation is introduced.
