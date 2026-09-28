# OpenRouter numeric error envelopes

## Issue and problem

- Issue: [#122](https://github.com/Theorvane/OpenGranter/issues/122), compatibility parent #116.
- /api/v1 client paths still return symbolic error.code, unlike the OpenRouter numeric status envelope.

## Scope and expected behavior

- On /api/v1/ paths return error.code equal to HTTP status, fixed message, safe metadata.opengranter_code and existing request_id/header.
- Preserve legacy /v1 envelopes and all success responses, authentication/IAM/limit/audit/usage behavior. Unknown or wrong-method API paths remain unavailable with the matching numeric error format.
- Node pre-header internal failures use the same path-aware format; post-header failures still destroy the socket.
- No route prefix rewriting, forwarded upstream metadata, streaming errors, retry hints or claimed complete compatibility.

## Design

- Add an explicit envelope format to the shared error response factory. The request dispatcher selects the format from pathname, without changing dispatch eligibility; Node fallback selects from the local request path.
- Preserve symbolic reasons as namespaced metadata for compatible clients while legacy callers retain their machine codes.
- See [contract](../../contracts/openrouter-error-schema.md), [compatibility matrix](../openrouter-compatibility.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).

## TDD plan

- Extend public safe-error conformance to expect numeric status and safe symbolic metadata on /api/v1, retaining exact legacy checks; cover all error categories and Node fallback over a real socket.
- Add query/near-prefix/unknown-method cases demonstrating format changes do not broaden route visibility. Preserve success and non-disclosure assertions.
- Record red before production edits, implement the explicit factory format, format/lint with no new warnings and run npm run check.

## Delivery

- Additive metadata but /api/v1 error.code changes type; clients use metadata.opengranter_code for detailed local reasons. Existing /v1 consumers are unchanged.
- No migration or live provider requests. Compatibility gaps remain explicit in #116.

## Verification evidence

- Red: 14 of 17 public handler/socket conformance cases failed with the prior symbolic API envelopes; legacy history and success baselines passed.
- Green: all 17 pass with numeric status codes, safe local metadata, exact legacy envelopes, queries/near-prefix behavior and parsed-request Node fallback.
- Focused Biome check of the error factory/test passes with --error-on-warnings and zero warnings.
- npm run check passes strict TypeScript, Biome, 523 tests and planning/link/contract/fixture checks. One external PostgreSQL test skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passes; CLAUDE.md remains a symlink. No schema migration or live upstream requests.
