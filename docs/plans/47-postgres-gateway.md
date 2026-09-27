# Compose PostgreSQL Gateway Ports

## Issue and problem

- Issue: [#47](https://github.com/Theorvane/OpenGranter/issues/47)
- Storage adapters are implemented separately, but no composition boundary connects them for real gateway requests.

## Scope and expected behavior

- Add a factory that supplies the existing HTTP handler with PostgreSQL credential verification, IAM attachment snapshots, published routes, audit append/read, and usage append/read.
- Require a trusted query client and explicit request-ID, clock, limits, secrets, and registered provider ports. No environment reads, connection creation, migration execution, management mutations, or new API behavior.
- IAM, revocation, required audit, and accounting failure behavior must remain unchanged. Integration exposed that generated Base64URL credential IDs can start with `-` or `_`, while the audit projector rejected those prefixes; reproduce this deterministically and allow the generated identifier format in credential attribution. Provider keys and request content remain outside persisted metadata.

## Design

- Compose the existing adapters and attachment authenticator; keep the request handler as the only HTTP boundary. Use an explicit external-port type so callers cannot override the composed security/storage ports.
- Apply all migrations through the existing runner in integration tests. Issue tokens through the internal primitive only as test setup.
- Update [architecture](../architecture.md), [PRD](../PRD.md), and [acceptance](../acceptance.md). Existing API contracts remain unchanged.
- Open decisions: production connection provisioning, secrets, limits, provider registration, SSO, and management APIs.

## TDD plan

- First add an integrated token-to-chat test with PostgreSQL IAM/catalog/audit/usage storage; expect the composition module to be absent.
- Test model listing, attributed usage/audit reads, explicit/default Deny, revocation, and safe storage/audit failure without inference replay.
- Add the smallest composition function and run focused tests, then `npm run check`.

## Delivery

- Use `feat/47-postgres-gateway`, authorized DCO and assistance trailers, and a ready PR linked to the plan and issue.
- This is an injected composition harness, not a deployed server. A single query client must supply the existing adapter contracts; connection lifecycle stays with the caller.
