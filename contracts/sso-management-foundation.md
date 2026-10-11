# SSO management foundation: planning status

SSO JWT verification and public management authentication remain pending implementation. The binding read foundation is delivered under #486, and lifetime caps are enforced at the existing internal service under the [lifetime contract](proxy-token-lifetimes.md). This is not an implemented public HTTP contract:

- Company SSO uses OIDC.
- The first management API authenticates SSO human users only. Service accounts continue using the LLM proxy; service management credentials require a later decision.
- Newly issued proxy tokens have a mandatory expiry and maximum lifetime of 30 days for human owners or 90 days for service owners.
- Existing iam:Manage policy evaluation on the target principal and required metadata decision audit remain in force. SSO authentication supplies identity, not an authorization bypass.

Confirmed on 2026-10-11: administrator-pre-registered issuer/subject bindings and API-specific SSO JWT access tokens; no automatic first-login creation. The [binding read foundation](sso-identity-bindings.md) is implemented under #486. HTTP paths, authentication profiles, migration handling for existing credentials, and implementation error contracts remain to be specified before their implementation. Recommendations are not requirements until confirmed.

The current internal facade, opaque credential primitives, and proxy HTTP endpoints remain as documented in [token management](token-management.md). JWT verification and the public management API remain pending; the binding read foundation and internal lifetime enforcement are delivered separately.
