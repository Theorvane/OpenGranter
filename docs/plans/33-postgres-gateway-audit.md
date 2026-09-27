# Persist Gateway Audit Metadata

## Issue and problem

- Issue: [#33](https://github.com/Theorvane/OpenGranter/issues/33)
- Gateway, managed-route, and delegated-route code already requires audit writes, but only an injected port exists. A PostgreSQL adapter is needed to retain its nonsecret events.

## Scope and expected behavior

- In scope: an append-only PostgreSQL table and TypeScript adapter for the three existing event unions. Store occurrence time, kind, request ID, optional authenticated attribution, and a projected JSONB details object with explicitly supported fields.
- Out of scope: audit read API, retention, tamper-resistant export, content audit, token-management decision events, PostgreSQL connection provisioning, and exactly-once audit delivery after ambiguous database commits.
- Anonymous authentication failures have null identity columns. Other events require valid principal, credential, and policy-version references. Extra object properties are not persisted. Malformed or unknown events and database errors fail with fixed safe errors.

## Design

- Use a discriminated projection by event kind. Copy only nonsecret identifiers, counts, reason enums, and bounded decision metadata. Never serialize the incoming event object directly.
- Store one row per successful append with an identity primary key. The adapter does not retry an ambiguous write; duplicate audit rows remain possible if an external caller retries. Audit export and stronger delivery semantics need a later decision.
- A trusted clock supplies the event occurrence time. Keep time and projection validation in front of the SQL call; catch driver errors without exposing SQL or payload details.
- Update [PRD](../PRD.md), [architecture](../architecture.md), and [acceptance](../acceptance.md). No ADR: this is a narrow persistence adapter following the existing audit contract.
- Open decisions: retention, reader authorization, tamper-resistant export, and retry/deduplication strategy.

## TDD plan

- First write a PostgreSQL-backed test that appends a known attributed event and reads its projected row; expect the adapter module to be absent.
- Add anonymous event, managed and delegated event, unknown kind, malformed attribution, hidden extra fields, invalid nested decision, and database-failure cases.
- Implement the migration and smallest allowlisted projector/append adapter. Run focused red/green tests and `npm run check`.

## Delivery

- Commit on `feat/33-postgres-gateway-audit` with the authorized DCO and assistance trailers. Open a ready PR linked to #33 and this plan.
- The adapter can be wired into the existing `writeAudit` port after deployment provisions PostgreSQL; no audit query surface is introduced here.
