# Require the exact chat JSON media type

## Issue and problem

- Issue: [#103](https://github.com/Theorvane/OpenGranter/issues/103).
- Prefix matching accepts unsupported media types and ambiguous comma-joined declarations as JSON, contrary to the chat boundary's supported application/json input.

## Scope and expected behavior

- Require the case-insensitive application/json type before the first parameter separator, with surrounding whitespace trimmed. Preserve existing parameter treatment, strict UTF-8 decoding, and byte-size cap.
- Missing/unsupported types use existing invalid-request denial/audit behavior before downstream work. Mandatory audit failure remains unavailable; authentication still precedes validation.
- No provider-specific content types, charset negotiation, new parameter validation, IAM, routing, usage schema, or endpoint changes.

## Design

- Replace prefix comparison with an exact comparison of the normalized type segment. Use existing invalid-request behavior rather than adding a new status/error contract.
- Expanding JSON suffix types would require a separate API capability decision. This fix only enforces the supported type already named by the reader.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/chat-media-type.md). Capability expansion remains open.

## TDD plan

- Through createChatHandler, reproduce prefix lookalikes and comma-joined declarations reaching inference.
- Cover missing/unrelated types, normal/uppercase/parameter/whitespace JSON, no downstream work on denial, denial audit failure, and authentication precedence.
- Implement the smallest normalized exact comparison, format, and run npm run check.

## Delivery

- Issue/plan precede coding. Include actual red/green evidence and validation in a ready PR.
- Clients declaring unsupported prefix lookalikes now receive the existing 400 invalid_request. Supported JSON remains unchanged. No migration; rollback restores prefix acceptance.

## Verification evidence

- Red: five regression cases failed while seven valid/unrelated/missing/authentication baselines passed on the original reader.
- Green: all 12 public gateway cases passed after normalized exact type comparison.
- `npm run check` passed strict TypeScript, Biome, 431 tests, and planning/link/contract/fixture checks. One external PostgreSQL driver test was skipped locally without a database URL; CI supplies PostgreSQL. Embedded database tests passed.
- `git diff --check` passed; `CLAUDE.md` remains a symlink to `AGENTS.md`. No schema change or live provider calls.
