# Gateway principal snapshots

## Issue and problem

- Issue: [#111](https://github.com/Theorvane/OpenGranter/issues/111).
- The HTTP handler retains mutable authenticator principal and policy references across body, catalog and route awaits. Changed policy or identity can diverge from authenticated audit attribution.

## Scope and expected behavior

- Capture known principal fields and nested statements/policy versions immediately after authentication, before subsequent asynchronous work.
- Original caller objects remain mutable; subsequent authentications capture current values. Model/provider permissions, limit identity and audit attribution use the captured context.
- Preserve safe authentication/audit failures. No SSO, public management API, policy reload or concurrent database locking guarantee.

## Design

- Deep immutable projection at the existing authenticate boundary. Snapshot exceptions follow existing authentication-unavailable handling before downstream work.
- Copying only audit attribution does not retain policy/limit identity; copying only during route authorization is too late after route lookup.
- See [contract](../../contracts/gateway-principal-snapshots.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).
- SSO decisions remain unresolved and outside this issue.

## TDD plan

- Reproduce source updates through HTTP managed/delegated route and model-catalog callbacks; verify original default/explicit Deny and allowed principal limit/audit attribution.
- Cover malformed authenticator snapshot and required audit failure, with no external calls on denied/failed requests.
- Implement the smallest projection, format, run targeted cases and npm run check.

## Delivery

- Issue and plan precede production edits; record red/green evidence in this plan and the ready PR.
- Small per-request copy/freeze allocations; no migration. Snapshotting does not retroactively revoke an in-flight request after DB changes.

## Verification evidence

- Red: seven of eight HTTP regressions failed on the prior code; required audit-failure baseline passed. Denied managed/delegated requests incorrectly returned 200, catalog policy updates widened visibility, and identity changes altered the in-flight result.
- Green: all eight targeted cases pass after principal snapshots.
- npm run check passed strict TypeScript, Biome, 456 tests, and planning/link/contract/fixture checks. One external PostgreSQL case was skipped locally without a database URL; CI supplies PostgreSQL.
- CLAUDE.md remains linked to AGENTS.md. No schema changes or live provider requests.
