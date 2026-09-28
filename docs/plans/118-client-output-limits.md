# Client output token limits

## Issue and problem

- Issue: [#118](https://github.com/Theorvane/OpenGranter/issues/118), compatibility parent [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- External clients send max_tokens but the current gateway rejects it and provider adapters omit its translation.

## Scope and expected behavior

- Accept optional positive safe-integer max_tokens on both chat paths, retaining the value through routing.
- OpenRouter/OpenAI use max_tokens; Anthropic uses max_tokens; Gemini uses generationConfig.maxOutputTokens.
- Direct registrations with maxOutputTokens bound requested output by the smaller value. Anthropic retains its existing registration default on omission; OpenAI/Gemini/OpenRouter omission retains existing native behavior.
- Invalid adapter values fail safely before secrets/transport; capture the primitive before asynchronous secret lookup.
- No sampling, tool-call, streaming, reasoning or context-window guarantees. Model-specific context limits remain upstream validation until trusted capability metadata exists.

## Design

- Add optional field to the known ChatRequest contract and validate at HTTP/adapter boundaries. Share a pure max-token predicate; do not blindly forward arbitrary request fields.
- Use explicit native mappings and a captured output limit. Applying the smaller bound retains both the caller's maximum and the administrator's configured maximum.
- Existing model/provider IAM, request limits, metadata audit and per-attempt usage remain unchanged. No content or secret logging.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility matrix](../openrouter-compatibility.md) and [contract](../../contracts/client-output-limits.md).

## TDD plan

- Public HTTP requests on both base paths reach all four real adapters with fake transports; assert native values and successful usage/audit behavior.
- First write failing adapter/public tests for minimum/typical limits, omission and direct registration caps; invalid runtime values reject before secret/fetch.
- Cover source mutation during secret lookup, IAM Deny, limit and required audit failures, and safe transport error with no content disclosure.
- Format, run focused cases, then npm run check.

## Delivery

- Plan/contract precede tests and code; report actual red/green evidence and validation in the ready PR.
- No migration; registered caps may return a shorter completion than the caller's maximum. This is a maximum, not a promised output length. Full compatibility remains incomplete.

## Verification evidence

- Red: 21 of 22 public adapter/HTTP cases failed on the prior implementation; invalid-public-input baseline passed.
- Green: all 22 cases passed with native mappings, omission/cap cases, malformed internal/public values, captured limits during secret lookup, both paths and security/failure checks.
- npm run check passed strict TypeScript, Biome, 506 tests and planning/link/contract/fixture scanning. One external PostgreSQL driver case skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passed; CLAUDE.md remains linked to AGENTS.md. No migration or live upstream requests.

## Review revision: checked test captures

- PR #119 requests replacing four non-null assertions on captured provider requests.
- Reproduce the four Biome warnings with the focused checker using --error-on-warnings, then narrow optional captures with assert.ok before reading native fields.
- This revision changes test access only; production semantics and contract assertions remain unchanged. Run the focused check and the full required check after editing.

- Review red: focused Biome check with --error-on-warnings reported four forbidden non-null assertion warnings.
- Review green: the same focused command now passes with zero warnings; all 22 output-limit tests pass.
- Full npm run check passes again: 506 tests, one external PostgreSQL skip, strict types, lint and document/contract checks. git diff --check passes.
