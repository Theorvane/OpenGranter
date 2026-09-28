# SSO management foundation: planning status

These are agreed requirements for a future management implementation, not an implemented public HTTP contract:

- Company SSO uses OIDC.
- The first management API authenticates SSO human users only. Service accounts continue using the LLM proxy; service management credentials require a later decision.
- Newly issued proxy tokens have a mandatory expiry and maximum lifetime of 30 days for human owners or 90 days for service owners.
- Existing iam:Manage policy evaluation on the target principal and required metadata decision audit remain in force. SSO authentication supplies identity, not an authorization bypass.

Pending decisions: pre-registration versus first-login identity creation; JWT access-token management authentication versus browser login/server sessions. HTTP paths, authentication profiles, migration handling for existing credentials, and implementation error contracts remain to be specified before their implementation. Recommendations are not requirements until confirmed.

The current internal facade, opaque credential primitives, and proxy HTTP endpoints remain as documented in [token management](token-management.md). This planning record introduces no production capability.
