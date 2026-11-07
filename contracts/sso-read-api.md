# Explicit single-listener SSO read API (#772)

`createPostgresSsoReadApiHandler` and `createPostgresSsoReadApiServer` from `src/gateway/postgres-sso-read-api.ts` compose existing identity and model read boundaries. The Node server is **unbound**. Nothing installs tables, listens, changes runtime dispatch or creates a browser session automatically.

## Configuration

Require own client, principalAuditClient, now, issuer, audience, jwks and newRequestId fields. Capture values once and project only those fields. Startup failures, including throwing getters, use fixed InvalidSsoAccessTokenConfiguration diagnostics. Extra authenticate/verifier/catalog/writeAudit properties cannot replace authority or disable required SQL audit.

The client supplies fresh identity/policy/catalog reads and committed catalog audit. The principalAuditClient supplies committed/autocommit identity-audit INSERTs. These may be the same correctly configured client; neither later transaction rollback nor database durability settings can be detected. Proposed `contracts/sql/current-principal-audit.sql` is still outside the default migration manifest and requires explicit owner/security installation review. The composer never starts/commits a transaction, executes DDL or retries ambiguous acknowledgements.

## HTTP behavior

- Exact GET `/management/v1/principal` delegates to [current principal](sso-current-principal-http.md), including mandatory SQL identity audit before the response. It discloses only the caller's current active human ID and kind, not roles, permissions, policy versions or claims.
- GET `/management/v1/models` and its slash-prefixed detail paths delegate to [SSO model catalog](sso-model-catalog-http.md), including fresh independent IAM, hidden-model behavior and required catalog audit. A detail alias containing slash must be encoded as one parameter.
- Other paths or methods return fixed404 not_found, no-store/nosniff, without request-ID generation, authentication, SQL, or audit. No fallback to token writes or inference. Supported-path malformed shapes retain existing400 behavior before private reads. Every response is no-store/nosniff, including Node fallback.
- Missing/expired/revoked credentials retain401 and Bearer challenge after required audit. Existing60-second verifier tolerance remains unchanged. Audit failure returns503 audit_unavailable without identity/models; authentication/catalog failures retain their original private503 codes.

Identity success does not authorize catalog reads. Explicit model Deny can yield empty list/private detail404 while principal remains200. Fresh binding removal denies both. Audit stores are independent obligations: missing identity table suppresses principal, not separately authorized and successfully audited model reads. This is not an organization-wide readiness gate.

## Evidence and limits

Tests use actual Node loopback HTTP, in-memory signed JWTs and explicitly migrated PGlite with the separately installed proposed identity table. They check principal/list/detail, changed Deny, binding revocation, missing/expired credentials, failed audit suppression, zero-work unmatched paths/methods, invalid shapes, capture and override rejection. This is not installed PostgreSQL, browser login, session/CSRF/CORS, live IdP, runtime acceptance or deployment certification. Browser-facing credential/session integration remains separately owned and gated.

## Existing Account compatibility (#774)

Exact GET `/management/v1/me` is also supported with the existing Account payload `{ principalId: <current human ID> }`, and no additional fields. It shares the same fresh registered-key verifier, exact active-human binding, required awaited identity audit, denial/failure privacy and malformed-shape validation as `/management/v1/principal`. The original path and `{id,kind}` projection remain unchanged. Lookalikes, trailing slash and other methods remain zero-private-work404. No URL rewriting, cookie session, new identity authority, runtime mount, schema installation or frontend change occurs. This closes a concrete wire-contract mismatch with the existing Account workspace; it does not certify that workspace in a native browser or install either server.
