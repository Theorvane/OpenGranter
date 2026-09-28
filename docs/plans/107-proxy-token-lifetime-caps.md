# Enforce owner-specific proxy-token lifetimes

## Issue and problem

- Issue: [#107](https://github.com/Theorvane/OpenGranter/issues/107).
- The contributor confirmed maximum new-token lifetimes of 30 days for human owners and 90 days for service owners in [the foundation plan](105-sso-management-foundation.md). The internal service currently checks future expiry but has no maximum.

## Scope and expected behavior

- Enforce the agreed caps on issuance through createPostgresTokenManagementService. One day is 86,400,000 ms; a cap boundary is inclusive, and expiry must be future relative to the credential creation timestamp.
- Fresh actor policy resolution and iam:Manage decision/audit precede target-kind lookup. Load the kind by exact target ID from trusted storage; ignore caller-nominated kind/cap fields. Missing, malformed, duplicate, or unavailable owner data fails safely.
- Reuse TokenManagementUnavailable for failures after an allowed decision, consistent with existing late issuance validation. Allowed decision audit records authorization, not successful token issuance; only successful mutation records an issued lifecycle event.
- Existing credentials and revocation are unchanged. This is an independent internal service slice; SSO identity binding and public management authentication remain pending and are not implemented here.

## Design

- Give the trusted PostgreSQL coordinator an optional owner-limit resolver. The service supplies its fixed persisted-kind resolver; lower-level trusted coordinator/credential primitives retain their existing behavior for infrastructure use.
- After required authorization audit, resolve the limit and capture one issuance time. Validate expiry against it, then use that same fixed time in the credential primitive, preserving atomic issuance/lifecycle behavior.
- Reading kind before authorization would disclose target data to denied actors. Trusting caller kind or rereading issuance time would undermine the cap. Use the existing safe error contract instead of designing public HTTP responses prematurely.
- No owner-policy snapshot is required: kind alone selects the cap. Target active-state semantics and concurrent target-kind updates remain as existing snapshot behavior; no transaction spans policy, kind read, decision, and mutation.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [token management contract](../../contracts/token-management.md), and [lifetime contract](../../contracts/proxy-token-lifetimes.md).

## TDD plan

- Through the actual internal service and embedded PostgreSQL, reproduce excessive human/service issuance with regression tests.
- Verify inclusive boundaries, forged request fields, policy denial and audit failure before owner lookup, malformed/missing/unavailable owner data, one captured issuance timestamp, and revocation of existing long-lived tokens.
- Implement the smallest resolver/guard, preserve lower-level primitives, format, and run npm run check.

## Delivery

- Issue/plan precede coding; record actual red/green and full-check evidence in a ready PR.
- Authorized calls with excessive expiry now fail safely after their authorization decision, without credential/lifecycle writes. No migration or retroactive expiry change.
- SSO and management API decisions remain outside this issue; this implements only the independently confirmed cap requirement.

## Verification evidence

- Red: six regression cases failed on the unrestricted internal service; three denial/audit, captured-time, and legacy-revocation baselines passed.
- Green: all nine focused embedded-PostgreSQL cases passed after the fixed owner resolver and issuance guard were added.
- npm run check passed strict TypeScript, Biome, 440 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver case was skipped locally without a database URL; CI supplies PostgreSQL. Embedded database cases and existing token management/credential suites passed.
- git diff --check passed; CLAUDE.md remains linked to AGENTS.md. No schema change or live external calls.
