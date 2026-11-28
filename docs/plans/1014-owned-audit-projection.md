# Durable owned-routing audit projection

## Issue and problem

- Issue: [#1014](https://github.com/Theorvane/OpenGranter/issues/1014), THE-19.
- The existing public append projector rejects the three owned event kinds emitted by unmerged core PR #1007.

## Scope and expected behavior

- Persist only bounded attribution, route/model, candidate and selection provenance through the existing audit table and reader.
- Reject malformed and unknown owned fields, including nested policy fields; preserve existing projections and history IAM.
- Exclude content, credentials, raw Jev responses, arbitrary metadata, gateway activation, UI, reservations and retention changes.

## Design

- Extend the shared projector and append input type with a standalone discriminated metadata contract. Reuse existing SQL, acknowledgement and history validation.
- Depend on the event shapes at PR #1007 head `7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04`, without copying its production implementation into this branch. Run genuine core compatibility in a temporary overlay against main and this change.
- THE-18's approved reservation contract and durable usage prerequisite remain unresolved. Test-only reservation ports prove audit ordering, never durable budget enforcement.
- Existing acknowledgement has no idempotency key or exactly-once guarantee: SQL/acknowledgement uncertainty stops the request, with no automatic replay; an operator investigates existing request-correlated history before any deliberate new request. No parallel recovery ledger.
- Update the owned audit contract and acceptance scenarios. No new domain decisions or runtime activation.

## TDD plan

- First capture a genuine frozen-core event and show public append rejects it before SQL.
- Add public append/read tests for all three kinds, enum variants, bounds, unknown fields, nested data, malformed attribution, SQL and acknowledgement failure, and authorized/denied history access.
- Verify frozen core performs no selection or inference on preselection append failure.
- Implement the smallest shared projection extension, then run focused tests and `npm run check`.

## Delivery

- Record RED/GREEN commands and frozen-core compatibility evidence in the PR; request separate independent review.
- Embedded PostgreSQL tests are API/storage evidence, not installed PostgreSQL or operational acceptance.
- Roll back the new projector cases and type; existing gateway remains unchanged. Unmerged core integration and durable reservations remain product prerequisites.
