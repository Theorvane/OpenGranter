# Direct provider registration store

## Issue and problem

- Issue: #55
- Direct adapters require caller-supplied registration arrays. Administrators need a persisted source for provider kind, secret reference, enabled state, and explicit output-token settings.

## Scope and expected behavior

- Add migration 007 and a PostgreSQL reader returning only enabled registrations, ordered by provider ID.
- Persist references rather than raw keys; retain the existing fixed upstream hosts and validation contract.
- Reject a malformed page completely with a fixed safe error. No partial registration set or driver details may escape.
- Exclude management writes, credential rotation orchestration, live reload, OpenRouter configuration, and HTTP startup.
- IAM checks still precede provider calls and secret resolution; the reader confers no permissions.

## Design

- Table: direct_provider_registrations with provider_id, kind, credential_ref, enabled, optional max_output_tokens. Anthropic requires a positive safe integer output limit.
- Extract the existing registration snapshot validator for reuse by both reader and invoker. Reader maps allowlisted fields only.
- One SQL statement supplies a consistent configuration snapshot. Callers explicitly load it when creating an invoker; changing or disabling a database row requires rebuilding the invoker. Immediate configuration reload remains future work.
- Update PRD, architecture, acceptance, and migration expectations. Publication authorization and audit remain separate work.

## TDD plan

- Add an absent-module test and confirm module-not-found red before implementation.
- Exercise persisted enabled/disabled providers of all three kinds, safe field projection, duplicate/invalid IDs, unsupported kinds, invalid references, invalid/missing output limits, and SQL errors.
- Invoke a registered OpenAI route through the loaded snapshot with a fake transport; confirm an unregistered provider reaches neither secret resolution nor transport.
- Run npm run check and all seven migrations against PostgreSQL 17; verify the actual bigint-to-number conversion and database constraints.

## Delivery

- Record red/green evidence and migration integration in the PR.
- Migration is additive; existing callers remain compatible. Operator deployment and connection ownership stay explicit.
- No raw provider key is returned by this reader, stored in this table, or included in errors. Credential references are trusted operator configuration and never sent to end users.
