# Trusted OpenRouter discovery metadata

## Issue and problem

- [#228](https://github.com/Theorvane/OpenGranter/issues/228), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116): the basic authorized alias list fails the official SDK's model schema. Trusted prices/capabilities are not currently stored.

## Scope and expected behavior

- Optional complete administrator-published discovery snapshots on aliases, stored in nullable JSONB by a new migration. Omission keeps current basic-list behavior; existing catalogs require no metadata backfill.
- Only /api/v1/models exposes the bounded snapshot and filtered total_count/terminal links.next:null. Alias IDs/publication timestamps remain authoritative gateway fields; /v1 remains basic.
- Keep whole-catalog fail-closed validation, model/final-provider IAM filtering and required listing audit. Capture nested metadata before audit awaits; no catalog fetching, secrets, limits, inference or usage on listing. No metadata in operational audit/errors.
- No price/capability inference, route aggregation policy, publication API, source-refresh service, query filters, billing changes, or complete conformance claim. Administrator-provided alias metadata is informational; correctness/refresh across configured candidates remains the administrator's responsibility, not inferred routing permission or provider identity.

## Design

- Add an optional openRouterMetadata field with a pure strict bounded snapshot validator for the required SDK model fields plus limited documented nested fields. Reject incomplete/unknown configured fields rather than silently claim support. Gateway owns id/created and legacy fields, so snapshots cannot override them.
- Reuse validation in SQL reads and the HTTP catalog boundary; metadata failure invalidates the complete catalog, including disabled entries. Use cloned frozen arrays/objects. Existing missing-snapshot behavior is deliberately preserved rather than hiding published aliases.
- Add migration 010 and the trusted migration-source manifest. Null/absent storage means unconfigured; configured metadata never contains inferred defaults. No new domain term or ADR.
- Official [model-list API](https://openrouter.ai/docs/api/api-reference/models/get-models) and installed official SDK 1.4.18 reviewed 2026-10-02. Source-pinned response schema traversal and richer optional metadata remain separate work.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), model catalog/discovery and official SDK contracts.

## TDD plan

- First actual official SDK socket test expects complete trusted catalog metadata to deserialize, currently rejected for missing context_length/other fields.
- SQL reader/migrated database tests first expect exact persisted metadata. Malformed/partial/unknown values fail safely; identity override cannot escape alias IAM.
- Verify legacy/basic behavior, denied/disabled/provider-denied aliases, empty visible list/count, audit failure and mutation during audit. Security controls run at public boundaries.
- Implement smallest projection/validator/storage changes, format and run npm run check; retain existing SDK gap tests for unconfigured catalogs.

## Delivery

- Issue/plan before code; issue-numbered branch and PR with red/green evidence. Merge only after approval and required CI.
- Risks: metadata can become stale or misdescribe a heterogeneous route unless administrators review it; missing snapshots retain SDK gaps. Advertised prices are catalog information, not provider-billed accounting or quotes. Existing migration deployment/checksum controls apply; richer metadata/source refresh remain open.
- Red evidence: actual SDK listing rejected the existing basic response; the SQL reader omitted configured metadata. A migrated database regression then failed with safe catalog-unavailable because the new column was absent. Implemented metadata first-response deserialization (SDK page.result), storage and denial/failure capture tests pass.
- Pagination remains an explicit gap: the SDK can request offset/limit after a large page despite links.next:null; queries remain rejected and this PR certifies only the first rich response.
- Final validation: npm run check passes strict types, lint (four existing warnings), 1,055 tests with one existing skip, planning/link/contract checks and pinned schema integrity. Eight new tests cover actual SDK sockets, persisted migration/read boundaries, malformed configuration, both route-kind IAM filters, capture, nullable fields and audit failure. Existing migration manifests/counts and compatible list-envelope assertions were updated.

## Review correction: single-read metadata snapshots

Review found repeated reads of moderation, modality, supported voices and per-request limits. A changing accessor can return a different value after validation, breaking the promised validated snapshot. Reproduce at the public model-list boundary with accessors that change between reads, then capture those values once and validate/project only the captures. Preserve immutable nesting, IAM filtering, audit secrecy and the additive migration scope. Record red/green and rerun full checks before reviewer approval.
