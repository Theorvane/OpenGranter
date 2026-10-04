# No-text length completions

## Issue and problem

- Issue: #324. Direct OpenAI/delegated OpenRouter nonstream responses with length
  and null/missing content but no reasoning payload fail safe upstream validation.
- Official nullable optional content and SDK permit this; guide documents no visible
  text when reasoning consumes output budget, with usage still billed.

## Scope and expected behavior

- Accept length-only null/missing content independently of request flags/usage.
  Normalize missing content to null consistently with existing response shape,
  preserve length and validated optional fields, and fabricate no output text.
- Empty-string behavior and substantive reasoning-only stop behavior stay unchanged.
  Stop without content remains a local unsupported subset, not official malformed
  schema. Reject malformed content/details/refusal/role and tool/finish mismatches.
- Direct OpenAI and delegated OpenRouter nonstream only, both bases; no native
  thinking, stream, history-input widening or full external certification.
- Preserve complete IAM/Deny, limits, required audit/usage, safe failures, actual or
  unknown usage and privacy. A delivered length completion is recorded as succeeded
  only after required persistence; do not infer zero usage or costs from no text.

## Design

- Add a narrow null/missing-content length allowance to shared assistant response
  normalization after existing role/details/tool validation; adapters already
  preserve finish and enforce their envelope/identity checks.
- Do not gate on exclude/request controls or usage categories: the response schema
  does not require them. No defaults, generated text or token-budget inference.
- Preserve canonical content-null normalization rather than changing the existing
  completion model and every downstream serializer. No new glossary term or ADR.
- Pin v18 already selects assistant content shape and is unchanged. Update PRD,
  architecture, acceptance, response/exclusion contracts and compatibility.

## TDD plan

- HTTP no-payload length null/missing success first fails 502; test both bases/routes,
  omitted/empty/null reasoning fields and metadata-only validated details.
- Reject malformed fields/tool finish and unsupported stop/null; preserve role and
  finish validation. Test request-control coexistence without requiring it.
- Exercise auth, implicit/explicit/model/provider Deny, limits, required usage/audit
  delivery gates, failed accounting/privacy and unknown usage without fabrication.
- Actual OpenAI/OpenRouter SDK sockets retain canonical null content/length/usage.
- Minimum shared condition, format/type checks, focused/full tests.

## Delivery

- Issue/plan, regression red, minimum green, docs/full checks, exact-head review as
  sjungwon03-ai, required CI, authorized sjungwon03 merge and clean main sync.
- Risk: empty stop/native/stream/history subsets stay open; rollback removes this
  narrow success allowance. Report red/green, skip and remaining #116 certification.

## Source and verification evidence

- Guide/OpenAPI/SDK inspection confirms documented no-text length and optional
  nullable assistant content. Existing missing-to-null canonicalization stays intact.
- Initial regression red: 2 passed, 4 expected failures before the length allowance.
- Focused response/reasoning/history green: 59 passed, covering both routes/bases,
  actual SDKs, malformed/stop/tool denials, required persistence and unknown usage.
- Exclusion regression expectation changes from null-length failure to success;
  the existing stop and malformed response tests stay green.
- Full npm run check passed type checking, linting, 1,481 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. The final
  evidence-only plan update also passes the planning checker.
