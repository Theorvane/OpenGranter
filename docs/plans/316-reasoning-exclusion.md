# Delegated reasoning exclusion preference

## Issue and problem

- Issue: #316. Documented reasoning.exclude boolean requests are rejected.
- The official reasoning guide supports exclusion alongside effort. Fresh OpenAPI
  and SDK 1.4.18 omit it; SDK serialization strips it. This is a documented raw
  request extension, not source-schema or SDK completeness.

## Scope and expected behavior

- Support optional exclude true/false in delegated reasoning objects on both chat
  bases, nonstream and existing ordinary text streams; preserve omission without
  default injection, and coexist with supported summary/effort and alias rules.
- Reject null, own undefined, malformed types and remaining unknown controls before
  routing/credentials. Null meaning is undocumented and remains outside the subset.
- Direct structured configurations remain pre-secret unsupported. Effort aliases,
  immutable snapshots and full history validation stay unchanged.
- Retain authentication, complete destination IAM/Deny, limits, required audit/usage,
  safe possible-billing outcomes, stream persistence and operational privacy.
- Do not locally suppress/fabricate response fields, guarantee exclusion/summary
  precedence, infer reduced token charges, or enable budget/enabled/legacy controls.
- Existing empty-string length responses remain successful; missing/null content
  without a substantive reasoning/refusal payload remains a documented gap with
  safe failed possibly-billed accounting. Broader no-content success needs design.

## Design

- Add boolean exclude to the shared immutable configuration projection. Capture
  once before async work and freeze alongside existing effort/summary preferences.
- Forward exactly to the administrator-approved delegated destination; no local
  response filtering or defaults. Local suppression would invent semantics and
  obscure upstream behavior. Native mapping is outside this slice.
- Pin v18 already selects the entire inline object, but exclude is absent from its
  official schema. Keep the pin unchanged and state the coverage gap explicitly.
- No new domain terms or costly domain decisions/ADR. Null, summary interaction,
  native mappings and complete #116 certification stay open.
- Update PRD, architecture, acceptance, compatibility and configuration contracts.

## TDD plan

- First HTTP true/false forwarding tests fail 400 before implementation. Cover
  omission, exact booleans, both modes/bases and effort/summary coexistence.
- Add invalid/null/undefined/unknown keys, conflicting aliases, single captures,
  mutation/getter failures, native pre-secret denial, auth/model/provider/explicit
  Deny, limits, required persistence, privacy and safe failed accounting.
- Actual OpenAI-compatible SDK sockets preserve the raw extension; actual pinned
  OpenRouter SDK sockets expose its stripping. Upstream fields are not filtered.
- Add excluded empty-string success and null-content safe failure regressions.
- Minimal projection change; focused tests, format/type checks and npm run check.

## Delivery

- Issue/plan, red public tests, minimum green, documentation, full checks, exact-head
  review as sjungwon03-ai, required CI and authorized merge as sjungwon03.
- Risks: provider support and returned details vary; SDK/schema gap is explicit.
  Rollback removes this optional request subset without altering core controls.
- Report red/green/full-check evidence, existing skip, unresolved limits and #116.

## Source and verification evidence

- Official guide documents booleans/default false and ongoing reasoning billing;
  fresh factual OpenAPI review and SDK serializer inspection confirm exclusion is
  absent/stripped. No null or summary precedence is invented.
- Initial public red: 2 passed, 6 expected failures; existing invalid controls and
  SDK stripping already pass, while supported forwarding/security paths fail.
- Initial green exposed an incorrect empty-string failure assumption in the test.
  Existing response normalization accepts all string content; preserve empty-string
  success and null-content safe failure without modifying production responses.
- Older unsupported-boolean exclusions are updated to the new request contract.
- Final focused reasoning/history green: 52 passed, including both SDK behaviors,
  exact forwarding, getters/mutation, Deny/persistence and billing regressions.
- Full npm run check passed type checking, linting, 1,454 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. The final
  evidence-only plan update also passes the planning checker.
