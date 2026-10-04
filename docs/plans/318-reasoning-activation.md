# Delegated reasoning activation preference

## Issue and problem

- Issue: #318. Documented reasoning.enabled boolean requests are rejected.
- Guide documents true/default activation and false in the unified disabled-thinking
  mapping. Omitted activation/default effort depends on the upstream model.
- Fresh OpenAPI and SDK 1.4.18 omit enabled; SDK strips it. This is a documented
  raw request extension with source/SDK gaps, not certified SDK coverage.

## Scope and expected behavior

- Accept enabled true/false for delegated OpenRouter on both bases, nonstream and
  existing ordinary text streams, alongside optional supported exclude/summary.
- Preserve exact booleans and omission without injecting defaults or effort.
- Reject null, own undefined, malformed values and remaining unknown controls early.
- Supplied enabled plus any nested effort (including null), or a forwarded named
  shorthand, is outside this local subset pending raw-chat interaction clarification.
  This is a scope restriction, not an official conflict rule. Existing top-level
  null normalization stays unchanged; null shorthand with enabled is supported.
- Direct structured configurations remain unsupported before credentials. Preserve
  auth, complete destination IAM/Deny, limits, required audit/usage, operational
  privacy, stream persistence and safe possible-billing failure accounting.
- No local response filtering, default effort inference, activation guarantee,
  reduced/free usage, budgets, native mappings or tool streams.

## Design

- Extend the existing shared immutable snapshot with a strict optional boolean.
  Compare captured effort presence/shorthand only; never reread caller getters.
- Capture enabled once, freeze and forward to approved delegated destinations.
  Passing unresolved effort combinations or selecting precedence is out of scope.
- Exclude/summary are independent forwarded preferences, not locally interpreted
  precedence. Model mandatory/default behavior stays upstream.
- Official v18 inline selection is unchanged and cannot certify an absent field.
  No new domain terms or irreversible trade-off/ADR is introduced.
- Update PRD, architecture, acceptance, compatibility and related contracts.

## TDD plan

- Public true/false forwarding first fails 400. Test both bases/modes, omission,
  boolean-only objects, optional exclude/summary and normalized-away shorthand.
- Test unsupported effort combinations, invalid/null/undefined/unknown keys,
  single capture/late mutation/accessor failures and native pre-secret rejection.
- Exercise auth, implicit/explicit/model/provider Deny, limits, required audit/usage,
  stream persistence, privacy and safe billing; preserve returned upstream reasoning.
- Actual OpenAI-compatible SDK sockets preserve the raw extension; pinned OpenRouter
  SDK sockets demonstrate stripping. Preserve existing effort and exclusion tests.
- Minimal projection extension; format/type checks, focused tests and npm run check.

## Delivery

- Issue and plan, meaningful red, minimum green, docs, full checks, exact-head review
  as sjungwon03-ai, required CI, authorized sjungwon03 merge and clean main sync.
- Risks: source/SDK omission, model support and unresolved raw-chat interactions.
  Rollback removes the optional subset without altering authorization/accounting.
- Report red/green evidence, full-check results, existing skip and remaining #116.

## Source and verification evidence

- Fresh guide/OpenAPI/installed SDK inspection confirms documented activation but
  absent schema/SDK fields. Raw-chat mixed-effort/null/precedence remains unresolved.
- Initial public red: 1 passed, 6 expected failures before supported forwarding.
- Previous unsupported activation-only tests now check malformed activation; mixed
  effort activation tests remain rejected under the explicit local scope restriction.
- Final focused reasoning/history green: 59 passed; exact forwarding, combinations,
  getters/mutation, both SDK behaviors and Deny/persistence/billing remain covered.
- Full npm run check passed type checking, linting, 1,461 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. The final
  evidence-only plan update also passes the planning checker.
