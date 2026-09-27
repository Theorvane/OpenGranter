# Opaque Proxy Token Lifecycle

## Issue and problem

- Issue: [#29](https://github.com/Theorvane/OpenGranter/issues/29)
- The gateway has an injected credential verifier but no OpenGranter-issued proxy token. Internal services cannot obtain, verify, or revoke a durable token through product code.

## Scope and expected behavior

- In scope: a trusted issuance primitive, one-time raw-token return, PostgreSQL digest storage and nonsecret lifecycle audit in the same SQL write, verification through the existing attachment-authenticator port, expiry checks, and idempotent revocation.
- Out of scope: management HTTP endpoints, human SSO, issuer IAM authorization, token display after issuance, rotation UI, and an operator-managed PostgreSQL connection pool.
- A token contains a random lookup ID and an independent 256-bit random secret. Only the digest of the full token and metadata are stored. A successful issue returns the raw token once after the credential and audit row commit. The caller supplies a trusted principal, actor, request ID, and future expiry; no default lifetime is settled here.
- A malformed, unknown, mismatched, expired, or revoked token returns no identity. Storage failures use a safe availability error. Revocation is effective on the next verification and never logs the raw token.

## Design

- Use an opaque versioned token format rather than a self-contained JWT so lookup and revocation are checked on every call. See [ADR 0006](../adr/0006-opaque-proxy-tokens.md).
- Add a narrow credential store and a PostgreSQL migration. Issue and revoke writes also append nonsecret credential lifecycle events in the same SQL statement, so a failed audit insert cannot leave an unrecorded credential change. The verifier reads only by random lookup ID and compares equal-length SHA-256 digests with Node's timing-safe primitive.
- Keep the service callable only from a trusted future management boundary. That boundary must authenticate the actor and check `iam:Manage` before issuing or revoking; this issue does not expose an HTTP route.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). The existing [Proxy token](../../CONTEXT.md) term remains canonical.
- Open decisions: maximum token lifetime, service-versus-human issuance policy, management endpoint UX, and audit export/retention.

## TDD plan

- First test issuance and verification with an embedded PostgreSQL store; expect the service module to be absent.
- Add malformed, wrong, expired, revoked, unknown, and store-failure paths; assert raw tokens never appear in tables, audit rows, or safe errors. Test issuance and revocation audit atomicity by making the audit table unavailable.
- Connect `verifyCredential` to `createAttachmentAuthenticator` in a boundary test. Run focused red/green tests, formatting, and `npm run check`.

## Delivery

- Commit on `feat/29-proxy-token-lifecycle` with the authorized DCO and assistance trailers; open a ready PR linked to #29 and this plan.
- Until the trusted management API and real PostgreSQL connection are implemented, these primitives are not a deployable token-management surface.
