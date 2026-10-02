# Emit compatible midstream error chunks

## Issue and problem

- Issue: [#222](https://github.com/Theorvane/OpenGranter/issues/222), release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Started delegated streams emit only the local safe error envelope, missing standard chunk identity and finish_reason:error expected by compatible clients.

## Scope and expected behavior

- For /api/v1 after a validated text-frame handoff, emit one SSE error chunk with the delivered id/created/local model alias, fixed chat.completion.chunk object and one index-zero content-free delta/finish_reason:error choice. Preserve safe numeric error, fixed message/metadata and request_id.
- Keep pre-first-frame JSON/status and legacy /v1 shapes unchanged. EOF follows error, never DONE or fabricated usage; cancellation/disconnected clients and required interruption audit retain existing behavior.
- Carry only explicit frozen identity scalars, excluding content/refusal/fingerprints/provider identity/secrets/raw errors. Required attempt ledger/outcome audit and IAM/limits remain unchanged.
- No upstream message/type propagation, retry classification, direct/tool streams or complete compatibility.

## Design

- Extend coordinator onFrame with a backward-compatible optional frozen identity projection after encoder validation. HTTP caches it only after successful awaited body handoff. Error encoding augments the existing trusted fixed error payload on the compatible path.
- Parsing serialized text again or inventing identities would add ambiguity; a narrow typed projection keeps protocol content out of retained state. Latest delivered created value is preserved without asserting cross-chunk timestamp equality. Body handoff remains distinct from physical socket acknowledgement.
- No new domain term or ADR. Independent of approval-pending PRs #217/#219/#221; integrate approved work when available.
- Official [streaming guide](https://openrouter.ai/docs/api_reference/streaming), checked 2026-10-02, describes unified midstream error chunks. See [contract](../../contracts/midstream-error-chunks.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md).

## TDD plan

- Add a public both-prefix failure-envelope regression expecting first-frame identity/error choice on /api/v1, absent on /v1; run before implementation and observe missing identity.
- Verify immutable allowlisted callback metadata; invalid first delta gives plain JSON; invalid later delta cannot replace delivered identity; upstream/ledger/outcome/interruption-audit errors remain sanitized; actual SDK socket throws safely with failed accounting.
- Implement narrow callback projection/cache/augmentation, format and run npm run check. No source pin changes.

## Delivery

- Issue/plan before implementation, branch/PR with red/green evidence. Merge only after CI and approval.
- Remaining risks: possible billing/unknown usage on failed attempts, closed-client delivery and audit recovery are existing operational limits. Full schema instance/client conformance remains open.

## Validation evidence

- Red before implementation: the compatible public failure regression found undefined error-chunk id instead of gen-1. Command: node --experimental-strip-types --test --test-name-pattern='compatible started error' test/delegated-http-stream.test.ts.
- Green: both-prefix upstream/ledger/audit error cases retain exact compatible identity/error choice and unchanged legacy shapes. Additional tests verify frozen identity-only callback metadata, invalid first/later metadata, interruption-audit replacement and an actual installed SDK socket failure with one possibly-billed failed attempt and interruption audit.
- npm run check passed against merged main: 1,012 tests passed and one existing test was skipped; strict types, lint, planning/link/secret checks and offline source-pin integrity passed. No source pin or runtime accounting/audit contract changed.
- Earlier PRs #217/#219/#221 have successful CI but remain approval-pending at delivery; this branch is independent of those changes.
- Integration after PRs #217/#225 merged: the old official SDK compatible gap assertion failed because the SDK now yields a valid error chunk. Update that assertion to verify delivered identity, numeric fixed error, finishReason:error, EOF, failed usage and interruption audit; retain the legacy parser-rejection assertion. The official SDK yields this failure rather than throwing automatically, unlike the OpenAI SDK.
