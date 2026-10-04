# Delegated reasoning token budget

## Issue and problem

- Issue: #320. Documented reasoning.max_tokens requests are rejected.
- Guide supports a numeric budget but has no generic null/zero/default/bounds schema.
  OpenAPI and SDK 1.4.18 omit the child field; SDK strips it.
- Guide says budget/effort are alternatives while model discovery mentions alongside
  effort. Explicit activation/budget precedence and summary interactions are unclear.

## Scope and expected behavior

- Forward optional positive safe integer max_tokens inside reasoning for delegated
  OpenRouter on both bases, nonstream and existing ordinary text streams. These
  numeric bounds are local subset policy, not official generic constraints.
- Preserve exact values/omission alongside optional supported exclusion/summary.
  Do not inject effort/defaults, clamp budgets or guarantee exact token allocation.
- Reject null/zero/negative/fraction/unsafe/nonfinite/own undefined/malformed values.
  Budget with any nested effort (including null), forwarded named shorthand or
  supplied enabled remains outside this local subset pending source clarification.
- Top-level null normalization and existing effort/activation-only rules stay intact.
  Native structured configurations remain unsupported before credentials.
- Preserve the outer output maximum, authentication, complete model/provider IAM/Deny,
  limits, required audit/usage, privacy, stream persistence and safe billing failures.
  No budget-derived charges, usage/default inference or response filtering.

## Design

- Extend the shared immutable projection with one captured positive safe integer.
  Compare captured effort/enabled presence and shorthand; never reread input getters.
- Keep provider-specific constraints upstream: Anthropic minimum/cap and output-budget
  relation do not become global rules; Gemini can translate budgets to thinking
  levels without exact token control. Capability/model defaults remain upstream.
- Alternative local translation/clamping would invent provider semantics and is
  outside this reversible raw preference slice. No new domain terms or ADR.
- Pin v18 stays unchanged and cannot certify an absent official child field.
- Update PRD, architecture, acceptance, compatibility and configuration contracts.

## TDD plan

- New public positive-budget forwarding first fails 400. Cover minimum local one,
  ordinary/documented/model-boundary-sized values and maximum safe integer, exact
  outer output cap/omission, both bases/modes and exclusion/summary coexistence.
- Invalid numbers/types and combinations reject before routes/secrets; test adapter
  own undefined/nonfinite/getters, mutation, safe accessor errors and native denial.
- Cover auth, implicit/explicit/model/provider Deny, limits, required persistence,
  safe failures/billing, no preference retention and no fabricated usage.
- Actual compatible SDK sockets preserve budget on both bases/modes; pinned
  OpenRouter SDK sockets demonstrate stripping. Existing reasoning suites stay green.
- Minimal snapshot change, format/type checks, focused tests and npm run check.

## Delivery

- Issue/plan, meaningful red, minimum green, docs/full checks, exact-head review as
  sjungwon03-ai, required CI, authorized sjungwon03 merge and clean main sync.
- Risks: documented source/SDK gaps, provider support and contradictory interactions.
  Rollback removes the optional subset without changing core controls.
- Report evidence, existing skip and unresolved interactions/native/tool-stream #116.

## Source and verification evidence

- Fresh guide/OpenAPI/installed SDK lookup confirms documented budgets but missing
  source/SDK shape, contradictory effort guidance and provider-specific constraints.
- Initial public red: 1 passed, 6 expected failures before supported forwarding.
- Prior unsupported budget-only tests now use zero; prior mixed effort/activation
  budget tests remain rejected under explicit local subset restrictions.
- Final focused reasoning/history green: 66 passed, including numeric bounds,
  immutable capture, SDK behavior, IAM/persistence/billing and unknown usage.
- Full npm run check passed type checking, linting, 1,468 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. The final
  evidence-only plan update also passes the planning checker.
