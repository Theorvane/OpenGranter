# Authorize Proxy Token Management

## Issue and problem

- Issue: [#31](https://github.com/Theorvane/OpenGranter/issues/31)
- The durable proxy-token primitive can issue and revoke credentials but has no IAM-enforcing caller boundary. A future management caller must not accidentally allow arbitrary token management.

## Scope and expected behavior

- In scope: a trusted TypeScript coordinator that takes an already authenticated actor with resolved policy statements, authorizes `iam:Manage` on `principal:<target-id>`, records nonsecret decision audit, then calls the existing token service. Revocation resolves the credential's immutable owner before evaluating the target resource.
- Out of scope: HTTP management endpoints, SSO, actor authentication, UI, maximum lifetime policy, delegated team administration, and service-account self-rotation rules.
- The actor comes from a trusted authentication boundary, never from a caller-controlled token request body. Inactive actors, missing attribution, default Deny, and explicit Deny stop before token writes. An unknown credential is treated as unavailable without revealing another principal's identity.
- A required decision audit write precedes token mutation. The token service's existing PostgreSQL lifecycle event is the atomic outcome audit for successful issue or revoke. No raw token, digest, or provider secret appears in decision audit or errors.

## Design

- Expose a narrow `findOwner` credential-store operation returning only the immutable principal ID for revocation authorization. Validate store results and fail closed.
- Keep the management actor distinct from a gateway proxy-token principal because future human SSO sessions may have no proxy credential ID. Include actor ID and resolved policy versions in audit attribution.
- Use the existing policy evaluator's default Deny and explicit Deny precedence. Reject invalid request IDs and target IDs before any store or token call.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). No ADR is needed for this narrow reuse of the established policy model.
- Open decisions: SSO protocol, HTTP management contract, token lifetime cap, and principal self-service rules. The resource choice `principal:<id>` follows the existing usage authorization convention for this internal slice and must be reviewed before exposing management endpoints.

## TDD plan

- First test a permitted actor issuing a token through the coordinator and expect the missing coordinator module to fail.
- Add default and explicit Deny, inactive actor, invalid actor attribution, unknown credential, wrong-owner permissions, lookup failure, audit failure, and successful revocation tests. Assert denied paths never invoke the token mutation.
- Add a PostgreSQL-backed owner-lookup test and check that no token or digest reaches decision audit events.
- Run focused red/green tests and `npm run check`.

## Delivery

- Commit on `feat/31-authorize-token-management` with authorized DCO and assistance trailers. Open a ready PR linked to #31 and this plan.
- A trusted management service must still supply authenticated actor context; this issue does not create a deployable management endpoint.
