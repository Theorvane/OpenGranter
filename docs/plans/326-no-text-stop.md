# Optional content on stop completions

## Issue and problem

- Issue: #326. Null/missing stop content requires substantive reasoning locally,
  although current assistant response schema/SDK permits optional nullable content.
- Full SDK deserializer accepts stop/no content/no reasoning/no usage with a valid
  envelope. Successful earlier source retrieval confirms no conditional payload rule;
  latest OpenAPI retry timed out, so no fresh full-source comparison is asserted.

## Scope and expected behavior

- Accept direct OpenAI/delegated OpenRouter nonstream stop null/missing content on
  both bases independently of request flags or reasoning/refusal/token categories.
- Keep canonical missing-to-null shape, stop/length and validated optional fields.
  Empty/metadata-only reasoning no longer needs to grant response success. No output,
  reasoning/budget explanation, zero counts or costs are fabricated.
- Reject malformed fields, role/envelope/model/finish/tool mismatches and no-text
  unknown/null finish as before. Project only validated own reasoning/detail fields.
- Preserve auth, complete destination IAM/Deny, limits, required usage/audit delivery
  gates, safe failures, privacy and actual or unknown usage. Delivered terminal
  success does not guarantee visible text and still requires persistence.
- No history-input, stream, native thinking or complete certification expansion.

## Design

- Replace separate length/payload guards with one null/missing stop-or-length
  condition after existing role/details/refusal/tool validation. The substantive
  payload scan becomes unnecessary for permitted terminal response content.
- Missing-to-null stays consistent with the existing completion representation.
  Exact source omission would alter downstream shape and is outside this slice.
- Keep own-field capture/projection and immutable detail validation; inherited
  reasoning cannot be projected or grant authority. No new domain term or ADR.
- Pin v18 already selects the assistant shape and stays unchanged. Update PRD,
  architecture, acceptance, response contracts and compatibility.

## TDD plan

- New public stop-only null/missing success first fails 502; cover both bases/routes,
  empty/metadata-only valid fields, malformed/tool/finish denials and unknown usage.
- Test auth/implicit/explicit/model/provider Deny, limits, required audit/usage,
  failed billing/privacy and actual OpenAI/OpenRouter SDK sockets.
- Update obsolete payload-gate expectations while retaining malformed-field tests
  and verifying inherited fields remain absent in normalized output.
- Minimum shared condition/refactor, format/type checks, focused and full checks.

## Delivery

- Issue/plan, meaningful red, minimum green, docs/full check, exact-head review as
  sjungwon03-ai, required CI, authorized sjungwon03 merge and clean main sync.
- Risk: optional-content semantics are wider than previous local guard; strict
  envelope/tools/fields and accounting remain enforced. Rollback restores gate.
- Report red/green/source limits/skip and remaining native/stream/history #116 gaps.

## Verification evidence

- Meaningful public red: 2 passed, 4 expected failures before optional stop content.
- Focused green: 65 passed after replacing obsolete payload-gate expectations with
  exact empty/metadata preservation and inherited-field exclusion assertions.
- Initial focused run exposed two prior signature-only stop rejection expectations;
  updated them to preserve the valid signature while retaining malformed-field gates.
- Initial full run found two outdated refusal-suite expectations; moved valid
  optional stop content/empty refusal cases to exact success projection coverage,
  retaining malformed refusal-type failure/privacy/billing assertions.
- Final response/reasoning/history/refusal focused green: 73 passed.
- Final full npm run check passed type checking, linting, 1,487 tests with one
  existing PostgreSQL skip, planning/contracts checks and offline pin integrity.
  The final evidence-only plan update also passes the planning checker.
