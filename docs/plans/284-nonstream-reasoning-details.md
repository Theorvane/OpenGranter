# Preserve nonstream reasoning details

## Issue and problem

- Issue: [#284](https://github.com/Theorvane/OpenGranter/issues/284), release gate #116.
- Compatible adapters silently omit supplied reasoning_details, losing opaque reasoning metadata.

## Scope and expected behavior

- Preserve optional arrays, including empty arrays, with summary/text/encrypted variants on direct OpenAI and delegated OpenRouter nonstream responses through both bases and SDKs.
- Validate required type/payload strings, optional nullable id/format/text/signature, safe integer index and exact selected keys. Copy once without parsing/decrypting data, signatures or format identifiers. Unknown string formats remain opaque.
- Reject null/non-array/malformed entries, unknown keys/types and server-tool-call variants rather than silently losing semantics. Reject own undefined fields. Retain existing finish/content/tool/refusal rules.
- Preserve IAM/Deny/limits, required audit/usage, safe possibly-billed failed attempts and missing usage. No reasoning content in operational records/errors.
- No stream/history/server-tool support or native Anthropic/Gemini thinking mappings. The selected runtime subset does not imply complete compatibility.

## Design

- Shared typed immutable detail snapshot helper used by assistant normalization; both compatible adapters already use this boundary.
- Official eight-definition source audit (#282) confirms three payload variants plus unsupported server-tool-call, optional integer index without minimum, nullable strings and extensible string formats. No invented provider authority or signature verification.
- Unknown keys fail safely as a local subset restriction; no new limit on array/string sizes. No glossary/ADR change or unresolved requirement implemented.
- Depends on [PR #241](https://github.com/Theorvane/OpenGranter/pull/241). Rebase only this issue's commit after its squash merge.
- Update PRD, architecture, acceptance, compatibility inventory and [contract](../../contracts/nonstream-reasoning-details.md).

## TDD plan

- First public response should show missing details; malformed/server-tool responses should initially succeed instead of failing safely.
- Cover variants/metadata/nulls/empty/omission, malformed fields, unchanged content/filter/tool outcomes, missing usage, IAM/provider Deny, required accounting/audit, immutable copies and actual SDK sockets.
- Implement minimal typed snapshot and attach at both existing assistant return paths; run focused tests and npm run check.

## Delivery

- PR records red/green, checks, dependency and remaining rich reasoning/history/stream gaps.
- No migration. Rollback removes new projection; do not certify complete reasoning compatibility.
- Require CI and approval before merge.

## Verification evidence

- Red: valid public response omitted reasoning_details; malformed data incorrectly returned 200 instead of 502.
- Green: all 27 focused tests pass, including fourteen new detail tests and thirteen existing reasoning regressions. Both bases/adapters, payload/metadata preservation, safe failure accounting, missing usage, denial/persistence gates, immutable capture and both official SDK sockets are covered.
- Full check passes strict types, lint, all tests, planning/link/contract/fixture checks and offline integrity. One existing optional PostgreSQL test remains skipped.
- An initial exactOptionalPropertyTypes error was fixed by omitting absent fields rather than weakening types.
- Actual merged heads require revalidation after dependency approval/merge.
