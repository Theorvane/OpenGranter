# SSO management foundation: planning status

The internal RFC 9068 JWT verifier and token-management composition are delivered under #488; the confirmed separate [public management HTTP contract](sso-management-http.md) is implemented under #492. The binding read foundation is delivered under #486, and lifetime caps are enforced at the existing internal service under the [lifetime contract](proxy-token-lifetimes.md). The agreed foundation is:

- Company SSO uses OIDC.
- The first management API authenticates SSO human users only. Service accounts continue using the LLM proxy; service management credentials require a later decision.
- Newly issued proxy tokens have a mandatory expiry and maximum lifetime of 30 days for human owners or 90 days for service owners.
- Existing iam:Manage policy evaluation on the target principal and required metadata decision audit remain in force. SSO authentication supplies identity, not an authorization bypass.

Confirmed on 2026-10-11: administrator-pre-registered issuer/subject bindings, API-specific SSO JWT access tokens and the RFC 9068 access-token profile; no automatic first-login creation. The [binding read foundation](sso-identity-bindings.md) is implemented under #486 and [internal token-management composition](sso-token-management.md) under #488. The contributor also confirmed registered RS256 public keys, maximum one-hour lifetime/age with 60-second clock tolerance, and required auth_time. Administrators must trust its end-user semantics. The contributor confirmed POST issue/revoke paths, no-store fixed errors, anonymous management authentication audit and 400 for authorized invalid lifetime under #492. Credential migration handling and deployment activation remain separate.

The current internal facade, opaque credential primitives, and proxy HTTP endpoints remain as documented in [token management](token-management.md). The public management HTTP factories are available separately; owned runtime activation and audited binding provisioning remain follow-up work.
