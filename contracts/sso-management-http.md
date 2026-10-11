# Public SSO proxy-token management HTTP API

Plan: [492-sso-management-http](../docs/plans/492-sso-management-http.md).

## Factories and identity

createSsoManagementHandler({newRequestId, authenticate, issue, revoke, writeAudit}) provides the injected Fetch boundary; these ports are trusted deployment code, never request fields. createSsoManagementServer provides the same boundary as an unbound Node HTTP server. createPostgresRfc9068SsoManagementHandler / createPostgresRfc9068SsoManagementServer accept {client, newRequestId, now, issuer, audience, jwks}, capture configuration once and compose the [local-key RFC 9068 verifier](sso-access-tokens.md), [current active-human binding](sso-human-authentication.md), [current IAM management service](token-management.md) and required gateway audit store. Invalid runtime configuration throws only the fixed InvalidSsoAccessTokenConfiguration error.

The caller owns listening, migration, deployment routing, TLS and database lifetime. Existing owned proxy runtimes do not activate these routes. Configuration/key changes require rebuilding the factory. Signed auth_time requires the registered issuer to attest actual human login. Service principals, unregistered identities and inactive humans cannot authenticate. No caller actor ID, claims object or proxy credential substitutes for SSO authentication; authentication is verified once for every request, then current IAM is loaded after body validation. There is no authentication/policy cache or administrator bypass.

## Routes and request boundaries

| Route | Exact JSON object | Success |
| --- | --- | --- |
| POST /management/v1/proxy-tokens | {principalId: string, expiresAt: number} | 201 {credentialId: string, token: string} |
| POST /management/v1/proxy-tokens/revoke | {credentialId: string} | 200 {revoked: boolean} |

Authentication uses one case-insensitive Bearer scheme and one nonblank token without whitespace or commas. Authenticate before consuming the body, checking its media type/shape or query parameters. Malformed/missing Bearer, rejected JWT and missing/current non-human binding are 401. Unexpected authentication failures are 503. Authentication failures require anonymous audit before responding.

After successful authentication, require application/json (case-insensitive media type, parameters permitted), valid fatal-decoded UTF-8 JSON and at most 16384 streamed bytes. Do not trust Content-Length to enforce the bound. Accept exactly the operation's own keys, rejecting extra keys including actor IDs, policy/cap overrides and request IDs. IDs are nonempty well-formed Unicode, at most 256 UTF-16 units and without NUL. expiresAt is an absolute epoch-millisecond nonnegative safe integer. Reject query parameters, malformed/empty bodies, invalid encoding, oversize streams and body-read failures with 400 before current IAM/mutation. Bound/cancel consumed streams and release the reader. Pre-dispatch cancellation stops mutation; cancellation after service dispatch does not certify rollback.

newRequestId supplies a trusted server-generated ID of 1..256 ASCII characters, matching [A-Za-z0-9][A-Za-z0-9._+:/@-]*. Never use caller X-Request-Id as authority or idempotency. Recognized requests return X-Request-Id; errors also include request_id. Generator failure/invalid IDs return safe 503 without reflection. Unknown paths or methods use fixed 404 before authentication/IDs. Node adapter failures before handler invocation use safe 503/no-store; the generic proxy bridge's default 500 response remains unchanged.

## Permission, expiry and response semantics

Only the derived active-human authenticatedActorId enters the trusted actor service. Reuse persisted current direct/role IAM attachments, iam:Manage on principal:<owner>, explicit Deny precedence, mandatory Allow/Deny decision audit and atomic credential lifecycle events. Unknown credentials deny without revealing an owner (403). A known already-revoked credential still requires owner-scoped current IAM and required decision audit before 200 {revoked:false}; no second lifecycle event is created.

For authorized issuance, persist the Allow decision before owner-kind lookup and lifetime checks. Human owners permit 30 days and service owners 90 days, from the single captured issuance timestamp. Past/equal-now or over-cap expiry throws fixed InvalidTokenManagementLifetime / Invalid token management lifetime and maps to 400 invalid_request. Owner/cap/clock/database/mutation failures remain unavailable (503). Policy Deny remains 403, and required decision/lifecycle audit failures remain 503 even when expiry is invalid. An Allow decision is not a success claim. Lower-level issuance without a lifetime guard retains its previous primitive error mapping.

All success, validation, authentication, authorization, availability, routing and Node fallback responses include Cache-Control: no-store. Success issuance projects only credentialId and the one-time token; revocation projects only revoked. Malformed trusted service outputs cannot expose partial secret material or claim completion. Fixed OpenGranter error envelope: {error:{code,message},request_id}; request_id is omitted when no valid server ID exists. No underlying error message, cause, request body or SSO claim is serialized.

| Status | Fixed code | Meaning |
| --- | --- | --- |
| 400 | invalid_request | Body/query validation, invalid authorized lifetime or pre-dispatch cancellation |
| 401 | unauthorized | Missing/rejected SSO identity; WWW-Authenticate: Bearer |
| 403 | forbidden | Current owner-scoped IAM denial |
| 503 | authentication_unavailable | Verification/binding dependency failure after successful auth-failure audit |
| 503 | audit_unavailable | Required anonymous authentication audit failed |
| 503 | internal_error | Request ID, current IAM/credential/decision audit or Node adapter unavailable |
| 404 | not_found | Unknown path or unsupported method |

## Anonymous authentication audit and limits

Use gateway_audit_events without a new migration. management-auth-denied and management-auth-unavailable project server timestamp, request ID and details:{operation:'issue'|'revoke'}. principal_id, credential_id and policy_versions are null even if the caller supplies extra fields. Never persist JWTs, issuer, subject, body, proxy secret or dependency messages. Failed append suppresses the original auth response and returns 503 audit_unavailable. Successful authentication creates no anonymous event; existing IAM decisions and atomic credential lifecycle events record authorized/denied work. Malformed authenticated bodies create no fabricated IAM decision. Existing principal audit-history visibility remains unchanged.

The boundary performs no inference, provider secret lookup, limit check or usage accounting. It preserves all proxy IAM/limits/audit/usage paths by not changing them. Separate binding, policy, cap and credential reads are not one transaction and do not revalidate intervening changes. There is no automatic retry, replay detection, introspection, access-token revocation check or issuance deduplication. A disconnect or response failure after issuance can leave a valid credential whose secret the caller did not receive; request IDs are correlation only. Audited binding provisioning, owned runtime activation, network key refresh and complete release gates remain follow-up work.
