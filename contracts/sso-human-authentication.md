# Reusable SSO human authentication

Plan: [490-sso-human-authentication](../docs/plans/490-sso-human-authentication.md).

createPostgresSsoHumanAuthenticator({ client, verifyAccessToken }) returns authenticateHuman(accessToken). The verification port is trusted internal deployment code, never a request-supplied decoder or identity object. Use the [RFC 9068 verifier](sso-access-tokens.md) for the configured profile. Required signed auth_time depends on the registered issuer using it only for actual end-user authentication.

Capture the two ports once. Reject invalid runtime input before verifier/SQL: the token must be a nonempty string of at most 16384 UTF-16 units, without NUL or ill-formed Unicode. Re-verify each call, then resolve the exact issuer/subject against the current [active-human binding](sso-identity-bindings.md). Return only its principal ID. Missing/rejected identity, missing binding, inactive humans or service principals throw SsoManagementUnauthenticated / SSO management unauthenticated. Verifier throws, malformed verified identity and binding failures throw SsoManagementAuthenticationUnavailable / SSO management authentication unavailable. Fixed errors contain no token, claims, underlying message or cause; a thrown verifier domain name supplies no authority.

Authentication adds no IAM bypass, policy read, credential issue/revoke, management-decision/lifecycle/authentication audit, account creation, inference or usage work. Binding parameters retain the reader's own single capture and frozen projection before asynchronous SQL; each later call sees current state. Changes after a read are not transactionally revalidated. No caller actor ID, extra claim or configuration mutation can substitute for the captured verification port and binding.

The [existing SSO management service](sso-token-management.md) reuses this boundary while retaining operation validation before authentication and existing current IAM/audit/mutation rules. Both error classes remain exported from its previous gateway module with the same constructor identity. Public HTTP processing order, responses and authentication audit remain a separate contract.
