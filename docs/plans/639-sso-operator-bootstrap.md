# SSO operator bootstrap (#639)

## Issue and problem

- Issue: #639; operational follow-through: #643.
- The reviewed SSO process requires an operator-written factory module even for the existing PostgreSQL/local-JWKS configuration. Provide an explicit reusable module rather than silently activating a new server.

## Scope and expected behavior

- In scope: opt-in trusted factory, required issuer/audience/public-JWKS/artifact environment configuration, bounded local public trust loading, existing PostgreSQL adapter.
- Out of scope: cookies, BFF, remote discovery, provisioning identities, schema changes, proxy/provider calls, installation or production activation.
- Authentication, fresh identity bindings, IAM, mandatory audit and token issuance remain in the reviewed runtime.

## Design

1. Load required explicit SSO configuration and absolute local paths.
2. Read at most 65536 bytes of a regular nonsymlink JWKS file using fatal UTF-8 decoding; reject empty, invalid and private keys through the existing RFC9068 configuration validator.
3. Return the existing service ports with a lazy PostgreSQL connection factory. No database connection is opened until the owned runtime starts.
4. Ship a zero-argument trusted module factory using standard PostgreSQL process environment; retain operator control over TLS and credentials. Do not print either.
5. Rotation requires a reviewed file replacement and process restart; no dynamic discovery/reload guarantee.

Alternative: handwritten deployment-only module remains supported, but adds avoidable integration work. This module is explicit, not the default start command. Session/ingress and installed recovery gates remain open.

Contract: [operator bootstrap](../../contracts/sso-operator-bootstrap.md). Existing [PRD](../PRD.md) and [acceptance](../acceptance.md) remain authoritative; no new endpoint or permission.

## TDD plan

- RED: new public loader import fails before implementation.
- GREEN: valid trust snapshot, deferred database ownership, immutable loaded keys, missing/relative/binary/oversized/directory/symlink/invalid/private trust inputs rejected with fixed safe errors.
- Composition: loaded configuration reaches the existing migrated Node HTTP runtime, anonymous rejection, signed bearer catalog response, binding revocation and owned shutdown.
- Run focused tests, full typecheck/lint, planning/contracts checks and compatibility pins; CI runs the full suite.

## Delivery

1. Record plan and contract before production code.
2. Add and execute RED acceptance tests.
3. Implement minimal loader and explicit module; execute GREEN and integration tests.
4. Publish exact-head PR and request independent formal review; merge only after all required CI and approval.

Rollback: do not select this module; existing custom factory remains unchanged. No deployment, paid call, browser-rendering, company IdP or installed PostgreSQL certification is implied.
