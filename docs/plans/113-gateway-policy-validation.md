# Authenticated gateway data validation

## Issue and problem

- Issue: [#113](https://github.com/Theorvane/OpenGranter/issues/113).
- The HTTP authenticator contract is typed, but custom runtime adapter results are not completely validated before copying nested policies. Invalid active states, effects or iterable non-array patterns can enter request processing.

## Scope and expected behavior

- Validate active boolean, existing identity/credential/version strings, recognized Allow/Deny effects and actual string-array patterns before projection.
- Reject malformed or sparse statement/version/pattern arrays at authentication with safe anonymous auth-unavailable audit and no downstream work. Required audit failure returns audit_unavailable.
- Preserve valid wildcard and empty-array semantics, inactive/absent authentication and existing immutable snapshots.
- No policy-language expansion, SSO decision, DB migration or additional product-specific bounds.

## Design

- Treat authenticated adapter data as unknown inside the private snapshot boundary, then construct a validated immutable known-field result. Use dense iteration so holes cannot bypass validation.
- TypeScript alone cannot verify runtime adapters. Validation at this boundary keeps malformed data out of inference, catalog and history authorization.
- See [contract](../../contracts/gateway-policy-validation.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).

## TDD plan

- Through public HTTP chat/models/usage/audit paths, reproduce malformed authentication and assert no routing/history/limit/provider calls.
- Cover unknown effects, string pattern containers, non-boolean active states, sparse arrays and invalid identities/versions, plus valid Allow/default/explicit Deny, inactive/missing callers and required audit failures.
- Make the smallest validation/projection change, format, run focused cases and npm run check.

## Delivery

- Issue and plan precede tests/code; record red/green and full validation in the ready PR.
- Custom adapters supplying invalid data will fail earlier with authentication_unavailable; valid typed adapters are unchanged. No migration or external requests. Rollback restores prior validation behavior.

## Verification evidence

- Red: 14 of 18 public HTTP cases failed before validation; existing baseline cases passed.
- Green: all 18 cases pass after dense runtime validation, including recognized effects/arrays/boolean active states, sparse inputs, all four endpoints, valid Allow/default/explicit Deny, inactive callers and mandatory audit failures.
- npm run check passed strict TypeScript, Biome, 474 tests, and planning/link/contract/fixture scanning. One external PostgreSQL test skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passed; CLAUDE.md remains a symlink. No schema migration or external provider calls.
