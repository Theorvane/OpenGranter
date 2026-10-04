# Delegated reasoning summary configuration

## Issue and problem

- Issue: #310; release gate #116 remains open.
- Strict client validation rejects official reasoning.summary configurations which
  the installed SDK and current official ChatRequest schema can serialize.

## Scope and expected behavior

- Accept optional reasoning object containing only optional summary with exact
  auto/concise/detailed/null values for delegated OpenRouter on both chat bases,
  nonstream and existing ordinary delegated text streams.
- Preserve omission, empty object and summary null without injecting defaults or
  effort aliases. Reject top-level null, invalid types/strings and unknown keys.
- Keep top-level reasoning_effort independent. Nested effort, budgets, exclusion,
  enabled and legacy include_reasoning stay unsupported; no precedence is inferred.
- Direct OpenAI/Anthropic/Gemini reject supplied configurations, including {},
  before credentials instead of dropping them or inventing native mappings.
- Preserve authentication, full destination IAM/Deny, limits, required audit/usage
  and privacy. This request preference grants no authority or summary guarantee.

## Design

- Add narrow typed immutable summary snapshot with plain-object/exact-key/enum
  validation and one capture before async routing/credentials.
- Extend gateway allowlist/projection, shared delegated request preparation and
  explicit direct capability rejection. Do not filter or manufacture responses.
- Official ChatRequest.reasoning.summary references the nullable summary enum;
  installed SDK 1.4.18 uses reasoning.summary directly. Existing pin v17 is not
  extended in this runtime slice; structural selection remains follow-up scope.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.
  No new domain vocabulary, costly irreversible decision or ADR is needed.
- Open: nested effort aliases, budgets/exclusion/native summary semantics, source
  drift selection, model capabilities and full external-client certification.

## TDD plan

- Public HTTP/SDK configured requests initially fail 400; adapter assertions show
  missing configuration. Verify all enum/null/empty/omitted states and both modes.
- Reject malformed/extra keys before route/credentials; test every direct kind,
  single getters and caller mutation during credentials, independent effort/history.
- Verify authentication, independent model/provider Deny, limits, required audit
  and ledger failures and safe possibly-billed upstream outcomes.
- Minimal typed snapshot/forwarding/native guard; focused tests then npm run check.

## Delivery

- Issue/plan, meaningful tests/red, minimal green, full checks, exact-head review,
  required CI, sjungwon03 merge and clean main synchronization.
- Risk: upstream model may ignore/reject summary preference; retain safe failures
  and no fabricated content/token accounting. Roll back this optional subset.
- Report source boundaries, evidence and remaining #116 gates in PR.

## Source clarification and verification evidence

- Official schema/SDK permit optional summary auto/concise/detailed/null and empty
  nonnullable reasoning objects, with no injected default. Summary-only objects
  serialize beside reasoning_effort without a nested effort alias conflict.
- SDK open enum accepts more values than this explicitly bounded named subset.
  Legacy include_reasoning is documented but absent from current ChatRequest and
  stripped by its SDK serializer; no legacy/native mapping is invented here.
- Initial red: 7 expected failures at public HTTP/provider/SDK boundaries.
- Focused green: 36 passed across summary/effort/detail-history suites, including
  streaming provider Deny and required persistence failures without final DONE.
- Full check and exact-head review/CI results are reported in PR.
- Additional getter-failure red reproduced an unsafe caller error on direct
  adapters; safe pre-secret capability rejection now catches it. Getter failures
  are sanitized on all four adapters, read once and never possibly billed.
- Final focused green: 37 passed (the earlier 36 plus this regression).
- Final npm run check: 1433 passed, one existing optional PostgreSQL integration
  skip; strict types/lint, planning/links/contracts/secret scan and offline pin
  integrity passed. No fresh live drift or complete compatibility claim is made.
