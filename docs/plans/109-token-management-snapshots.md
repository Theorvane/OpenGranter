# Retain token-management operation snapshots

## Issue and problem

- Issue: [#109](https://github.com/Theorvane/OpenGranter/issues/109).
- Mutable caller operation objects and actor context are reread after asynchronous work, allowing an in-process caller update to change this operation's target, credential, expiry, or attribution.

## Scope and expected behavior

- Capture validated service request fields before actor snapshot lookup. Capture validated coordinator operation fields and project immutable actor, statement arrays, policy arrays, and version records before asynchronous owner/audit work.
- Owner lookup, IAM decision, audit, and mutation use the same captured operation and actor values. Keep original objects mutable; subsequent calls inspect current caller values and the service still reloads current persisted policies each time.
- Preserve existing Allow/Deny, error, audit-order, revocation, expiry, and token-storage contracts. No SSO endpoint, new policy, credential schema, concurrent DB transaction, or policy revalidation guarantee.

## Design

- Copy primitive request fields at each public internal boundary. Build the actor snapshot only from known validated fields and freeze nested arrays/records to prevent callbacks from mutating evaluated attribution.
- Freeze decision events before giving them to the audit port. A callback attempting to mutate frozen data follows existing audit exception handling and blocks mutation.
- Merely copying an operation object would retain actor policy references; copying only at the coordinator would still permit a service request update during actor resolution. Both boundaries need snapshots.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [token contract](../../contracts/token-management.md), and [snapshot contract](../../contracts/token-management-snapshots.md).

## TDD plan

- Through the public coordinator, reproduce issue/audit and revoke/owner callback updates, retained policy Deny/inactive states, attribution immutability, and mandatory audit failure.
- Through the service and embedded PostgreSQL, update request fields during actor lookup and verify the original issue/revoke operation reaches storage with original attribution.
- Implement snapshots, keep existing management/credential suites green, format, and run npm run check.

## Delivery

- Issue/plan precede tests and code; report red/green and validation in the ready PR.
- Copy/freeze adds small per-operation allocations. Trusted callbacks must honor existing readonly types. No migration; rollback restores reference rereads.
- Approved PR #108 was merged and integrated before publishing this change; its lifetime caps remain enforced alongside operation snapshots.

## Verification evidence

- Red: seven snapshot regression cases failed on the prior implementation; the required audit-failure baseline passed.
- Green: all eight coordinator/service cases passed after snapshots and immutable decision metadata were added.
- Initial npm run check passed strict TypeScript, Biome, 439 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver case was skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passed; CLAUDE.md remains a symbolic link to AGENTS.md. No schema or live external calls.

## Integration verification

- Integrated approved PR #108 from main. Resolved additive planning-document conflicts by preserving both lifetime-cap and operation-snapshot requirements.
- Combined npm run check passed strict TypeScript, Biome, 448 tests, and planning/link/contract/fixture checks; one external PostgreSQL case was skipped locally without a database URL.
