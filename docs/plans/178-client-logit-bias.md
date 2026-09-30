# Nullable Client Logit Bias

## Issue and problem

- Issue: [#178](https://github.com/Theorvane/OpenGranter/issues/178).
- The exact-key HTTP boundary rejects official optional logit_bias, preventing configured OpenRouter/OpenAI clients from using token-bias controls.

## Scope and expected behavior

- Accept omission/null or a JSON object with exact string token keys and finite numeric values. Preserve empty objects, empty/Unicode keys and supplied numbers because the official source declares no further constraints; malformed types and non-finite values reject.
- OpenAI direct and delegated OpenRouter forward immutable snapshots; direct Anthropic/Gemini reject non-null maps before secrets/transport. Null omits native control across all routes.
- Client-supplied mappings cannot change IAM authority, route selection, usage/audit attribution or limits. Keep mapping keys/values out of operational logs, metadata audit and errors. No native prompt rewriting or capability-aware rerouting.

## Design

- Add a shared plain-object snapshot validator and optional ChatRequest field. The HTTP normalizer uses exact request keys and freezes the mapping before awaits; direct/delegated invokers independently validate native calls before secret lookup.
- Include map only in supported native request bodies. Refuse unsupported direct routes, including empty maps. Distinguish null from map and omit null.
- Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), raw snapshot retrieved 2026-09-29: nullable object with numeric additionalProperties, no key pattern or numeric range. The installed OpenAI SDK accepts a record-like logit_bias field.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-logit-bias.md). Selected schema pin currently excludes this field; future reviewed source-drift expansion is separate. Per-model/provider range semantics remain unresolved.

## TDD plan

- First HTTP/SDK/native tests must reproduce exact-key denial and native drop. Test omitted/null/maps, exact key/value capture, non-finite/native malformed values, both prefixes, supported/unsupported providers and mutation during secret await.
- Verify IAM/limits/audit denial and safe failed-attempt accounting without data leakage. Minimal validator/snapshot and forwarding, focused green, full npm run check.

## Delivery

- Ready issue-scoped PR with plan, red/green and validation evidence.
- Roll back field validation/forwarding together; no stored-data migration or identity policy change.

## Verification evidence

- Red: all 18 new cases failed before implementation, reproducing exact-key HTTP denial, missing native forwarding, unsupported-provider behavior and security-path mismatch.
- Green: all 18 HTTP/SDK/native/security tests pass, including immutable map capture before secret awaits and safe failure accounting.
- Final npm run check passes: 874 tests pass, one optional external PostgreSQL test skips. Type checking, lint, planning validation and pinned integrity pass; local PGlite tests run. Git diff whitespace checks pass.
