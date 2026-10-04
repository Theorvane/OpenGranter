# Delegated nested reasoning effort

## Issue and problem

- Issue: #314; release gate #116 remains open.
- Runtime rejects the official nested effort field already structurally selected
  by pin v18. Official shorthand prose forbids simultaneous differing values.

## Scope and expected behavior

- Delegated OpenRouter supports optional effort max/xhigh/high/medium/low/minimal/
  none/null in its existing reasoning object, alongside optional summary.
- Preserve omission, {}, nested null and exact named strings, without defaults,
  alias rewriting or merging. Existing top-level null still normalizes to omission.
- Identical simultaneously forwarded named aliases are permitted; differing names
  reject before routing. Nested null plus a forwarded shorthand string stays an
  unsupported local subset pending clarification, not an official null-precedence
  requirement. Native/direct configurations remain rejected before credentials.
- Both bases, nonstream and ordinary delegated text streams retain existing IAM,
  limits, required audit/usage and privacy. No control grants routing authority.
- Budget/enabled/exclude/legacy controls and native mappings remain out of scope.

## Design

- Rename the summary-only helper/type to reasoning configuration, with immutable
  exact-key effort/summary validation and optional captured shorthand comparison.
- Capture each field once before async work at HTTP and provider boundaries.
  Compare only already-validated captured values; never reread caller getters.
- Update existing expected unsupported-effort tests and add public alias cases.
- Update PRD, architecture, acceptance and contracts; pin v18 remains unchanged
  because whole inline effort is selected. No new domain terms or irreversible ADR.
- SDK permits both aliases without validation; gateway must enforce the official
  differing-string rule. Per-model support and mixed-null semantics remain open.

## TDD plan

- Nested effort HTTP/SDK success first fails 400; direct provider preparation
  rejects unknown nested keys. Add exact states, equal/conflicting aliases and
  unsupported null mix, typed input getters, mutation and safe failures.
- Cover function/opaque history, summary coexistence, both modes/bases, independent
  model/provider Deny, authentication, limits, required persistence and billing.
- Minimal helper/boundary changes, focused reasoning tests and npm run check.

## Delivery

- Issue/plan, tests/red, minimal green, full checks, exact-head review/CI,
  sjungwon03 merge and clean main synchronization.
- Risk: model support differs; preserve safe upstream failure accounting without
  inferring thinking budgets or generated content. Roll back optional subset.
- Publish red/green evidence, local null restriction and remaining #116 gates.

## Source and verification evidence

- Official schema declares the same seven named nullable effort values, no default,
  and a differing-value alias prohibition in prose. SDK serialization does not
  enforce that prohibition. Mixed-null meaning remains outside the local subset.
- Initial new public red: 1 passed, 6 expected failures (nested configurations
  rejected before intended forwarding/security/SDK paths).
- Final focused reasoning/history green: 44 passed, including single captures,
  mutation, matching/conflicting aliases, complete function and opaque history,
  native pre-secret rejection, Deny/persistence failures and SDK sockets.
- Summary-only regressions remain green; previous unsupported-effort expectations
  are updated to the new supported/equal or still-conflicting contracts.
- Whole inline schema is already selected by v18; source prose changes remain
  outside structural drift. No fresh live-source comparison is claimed here.
- Full checks and exact-head review/CI results are reported in PR.
- Full `npm run check`: type checking, linting, 1,446 passing tests with one
  existing PostgreSQL skip, planning/contracts checks and offline pin integrity.
