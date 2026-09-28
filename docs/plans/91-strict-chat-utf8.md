# Reject malformed UTF-8 chat input

## Issue and problem

- Issue: [#91](https://github.com/Theorvane/OpenGranter/issues/91).
- The streaming JSON reader silently replaces malformed UTF-8 bytes, changing user messages before inference.

## Scope and expected behavior

- Reject malformed and truncated UTF-8 with the existing invalid-request response and metadata denial audit. Preserve valid Unicode, including literal replacement characters and multibyte characters split across chunks.
- Cancel unread input on decoding failure; suppress cancellation errors through the existing invalid-request boundary.
- No changes to IAM, upstream adapters, usage accounting, body-size limit, streaming output, or content-audit decisions.

## Design

- Use the standard fatal streaming UTF-8 decoder and flush it at end of input. Cancel the reader if decoding throws and release its lock in all cases.
- Retain the existing handler's denial and audit-unavailable responses. Authentication continues to precede body validation.
- Replacing malformed input would alter user content; failing validation preserves the existing requirement to validate incoming bodies.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [contract](../../contracts/chat-utf8.md). No new unresolved product choices.

## TDD plan

- First reproduce malformed and truncated bytes reaching inference through `createChatHandler`.
- Cover unread-stream cancellation, cancellation failure, audit failure, valid split Unicode, and literal U+FFFD.
- Implement the smallest strict decoder change; run focused tests, format, and `npm run check`.

## Delivery

- Record issue and plan before tests and code, then open a ready PR with actual red/green evidence.
- Clients sending invalid UTF-8 now receive 400; valid JSON bytes retain their text. Rollback requires no migration.

## Verification evidence

- Red: the focused suite failed six assertions on the previous implementation: altered malformed input reached inference, cancellation was absent, and the reader lock remained held on rejection and valid input.
- Green: all six focused cases passed with no cancelled tests after the strict decoder and cleanup change.
- `npm run check` passed strict TypeScript, Biome, the full test suite, and planning/link/contract/fixture checks. One external PostgreSQL driver case was skipped locally without a database URL; embedded database tests passed and CI supplies PostgreSQL.
- `git diff --check` passed; `CLAUDE.md` still points to `AGENTS.md`. No schema change or live provider calls.
