# Safe client error messages

## Issue and problem

- Issue: [#120](https://github.com/Theorvane/OpenGranter/issues/120), compatibility parent #116.
- External clients expect error.message; the gateway and Node internal fallback currently expose only safe symbolic codes.

## Scope and expected behavior

- Add allowlisted English messages to every existing gateway error and pre-header Node fallback. Preserve statuses, symbolic codes and request IDs.
- Never interpolate request fields, exception strings, credentials, upstream bodies or protected content. Existing required audit and accounting behavior remains unchanged.
- Numeric OpenRouter codes, typed metadata, retry hints and streaming errors remain compatibility work; this is an additive message slice.

## Design

- Share a typed known-code response factory and fixed message map between the Fetch handler and Node bridge. New internal codes must have a safe message at compile time.
- Retain the current code contract so callers can keep machine-readable matching while external tools display the message.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/safe-client-errors.md).

## TDD plan

- Public gateway failure cases for every current code assert fixed messages and absent private markers on both base paths. Include successful response baseline and a real Node fallback socket case.
- Run red before implementation; add the response factory and update existing exact-envelope expectations for the additive field without weakening code/status assertions.
- Format, focused checker without warnings, full npm run check.

## Delivery

- No migration; unknown clients enforcing exact response keys must allow the standard message field. Rollback removes the additive field.
- Keep full compatibility open; report red/green and all checks in the ready PR.

## Verification evidence

- Red: 15 of 16 public handler/socket cases failed because message was missing; success-response baseline passed.
- Green: all 16 cases pass after fixed message projection, including private-data exclusion and both client base paths.
- Focused Biome check of the new factory/test passes with --error-on-warnings and zero warnings.
- npm run check passes strict TypeScript, Biome, 522 tests and planning/link/contract/fixture scanning. One external PostgreSQL case skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passes; CLAUDE.md remains a symlink. No schema migration or live upstream calls.
