# Assistant refusal content-part normalization

## Issue and problem

- Issue: #332. HTTP only normalizes text arrays, so valid OpenAI assistant history
  with one refusal content part cannot reuse the existing scalar refusal pathway.
- Current OpenAI reference supports exactly one refusal part. Earlier OpenRouter
  schema and pinned SDK omit that variant; raw SDK serialization rejects it while
  the canonical scalar refusal works. No fresh OpenRouter comparison is asserted.

## Scope and expected behavior

- Both bases normalize a single exact assistant refusal part with string payload
  to content:null/refusal:string, retaining empty/Unicode/newline values. Existing
  direct OpenAI/delegated history, metadata and complete function groups apply.
- Existing delegated ordinary text streams remain supported; tool/direct streams,
  multimodal and native Anthropic/Gemini mappings remain unsupported.
- Reject mixed/duplicate/malformed/unknown/nonassistant parts and any simultaneous
  explicit scalar refusal as a bounded local ambiguity restriction, not an official
  conflict rule. No precedence, concatenation or silent discard is introduced.
- Capture message/part input values once and use immutable downstream snapshots.
  Preserve complete tool-result groups, IAM/Deny/limits, required usage/audit,
  safe possibly-billed failures, operational privacy and unknown usage.

## Design

- Extend only HTTP normalization; internal ChatMessage keeps the existing canonical
  scalar refusal and nullable content. Raw typed adapters remain canonical-only.
- Snapshot enumerable own message fields once before processing content rather
  than reading getters again during projection. Inspect the sole refusal payload
  once and validate exact keys.
- Use existing provider gates after normalization; no new native mapping or schema
  pin. This is OpenAI-client translation, not OpenRouter raw-array conformance.
- No new domain terminology or costly trade-off ADR. Duplicate representations and
  richer parts remain explicit gaps. Update PRD, architecture, acceptance/contracts.

## TDD plan

- Public single refusal part success fails 400 before implementation. Cover both
  supported routes/bases, empty/Unicode payload, metadata/function preservation,
  exact normalization and getter/caller mutation capture.
- Reject malformed/mixed/duplicate/nonassistant/conflicting scalar shapes before
  routing; preserve pending result validation and native pre-secret rejection.
- Cover auth, implicit/explicit/model/provider Deny, limits, required persistence,
  safe failures and missing usage on existing supported modes.
- Actual OpenAI SDK sockets on both routes/bases; delegated ordinary streaming.
  Pinned OpenRouter SDK rejects raw parts but accepts canonical scalar input.
- Minimum normalizer implementation, focused tests/format/full npm run check.

## Delivery

- Issue/plan, meaningful red, green, docs/full check, exact-head AI review, required
  CI, authorized human merge and clean main sync. #116 remains open.
- Risk: representation translation; tests assert exact canonical refusal and no
  visible assistant text. Rollback restores text-only array validation.

## Verification evidence

- Public red: 1 passed, 5 expected failures before implementation.
- Initial minimum implementation exposed two content getter reads under object-rest
  destructuring. A single message snapshot fixes the regression; refusal payload
  and content are captured once and credential-await mutation cannot change output.
- Focused normalizer/history/function green: 55 passed. Actual OpenAI SDK sockets
  cover both routes/bases and delegated ordinary text streams; pinned OpenRouter
  SDK explicitly rejects raw refusal arrays and accepts canonical scalar refusal.
- Existing malformed text/history cases remain intact. Final npm run check passed
  type checking, linting, 1,506 tests with one existing PostgreSQL skip, planning/
  contracts checks and offline pin integrity. Evidence-only plan update also passes
  the planning checker. No fresh OpenRouter full-source comparison is asserted.
