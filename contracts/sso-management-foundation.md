# SSO management foundation: planning status

The internal RFC 9068 JWT verifier and token-management composition are delivered under #488; public management HTTP authentication remains pending. The binding read foundation is delivered under #486, and lifetime caps are enforced at the existing internal service under the [lifetime contract](proxy-token-lifetimes.md). This is not an implemented public HTTP contract:

- Company SSO uses OIDC.
- The first management API authenticates SSO human users only. Service accounts continue using the LLM proxy; service management credentials require a later decision.
- Newly issued proxy tokens have a mandatory expiry and maximum lifetime of 30 days for human owners or 90 days for service owners.
- Existing iam:Manage policy evaluation on the target principal and required metadata decision audit remain in force. SSO authentication supplies identity, not an authorization bypass.

Confirmed on 2026-10-11: administrator-pre-registered issuer/subject bindings, API-specific SSO JWT access tokens and the RFC 9068 access-token profile; no automatic first-login creation. The [binding read foundation](sso-identity-bindings.md) is implemented under #486 and [internal token-management composition](sso-token-management.md) under #488. The contributor also confirmed registered RS256 public keys, maximum one-hour lifetime/age with 60-second clock tolerance, and required auth_time. Administrators must trust its end-user semantics. HTTP paths/errors/audit and credential migration handling remain separate. Recommendations are not requirements until confirmed.

The current internal facade, opaque credential primitives, and proxy HTTP endpoints remain as documented in [token management](token-management.md). The public management HTTP API remains pending; the binding read foundation and internal lifetime enforcement are delivered separately.
