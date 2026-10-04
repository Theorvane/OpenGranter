# Assistant refusal history

## Issue and problem

- Issue: #330. Returned assistant refusal messages cannot currently be replayed
  because history field validation rejects refusal.
- Installed OpenRouter SDK 1.4.18 and previously retrieved assistant schema define
  optional nullable refusal; current OpenAI request reference documents the same.
  Fresh OpenRouter full-source comparison is not asserted.

## Scope and expected behavior

- Both bases preserve omitted/null/empty/Unicode refusal in assistant ordinary and
  complete function histories on delegated OpenRouter/direct OpenAI. Normalize
  missing content to null under existing message shape.
- Direct OpenAI accepts validated supplied refusal with canonical null content;
  bare-null history remains unsupported. Anthropic/Gemini reject supplied refusal
  before secrets, including null/empty and messages with visible content/calls.
- Existing delegated ordinary text streams support refusal history. Tool/direct
  streams, refusal content parts, rich/native mapping and certification stay open.
- Reject malformed/non-assistant/own undefined markers; preserve pending tool-result
  validation and immutable single capture. History grants no policy or authenticity.
- Auth, full model/provider IAM/Deny, limits, required usage/audit, operational
  privacy and safe possible-billing failures remain shared. No usage is inferred.

## Design

- Add assistant-only optional refusal to ChatMessage and both snapshot allowlists,
  capture once using own-field presence, validate string/null and freeze projection.
- Direct guard rejects native unsupported markers independently of content; permit
  OpenAI no-text history only with supplied validated refusal or nonempty calls.
- OpenAI reference permits nullable content and independent refusal without a
  nonempty rule; supplied canonical null preserves content presence. Forwarding
  does not guarantee every model accepts a history semantically.
- No new domain term/ADR; reversible compatibility subset. Update PRD, architecture,
  acceptance and contracts. Pin v18 already selects assistant shape and stays fixed.

## TDD plan

- Public assistant refusal history fails 400 before implementation; cover both
  supported route kinds/bases, ordinary and complete tool groups, null/empty
  markers, immutable getter/mutation and actual SDK sockets.
- Cover malformed/non-assistant fields, own undefined/accessor errors, incomplete
  tools, native pre-secret rejection, auth/IAM/Deny/limits/persistence/upstream
  failure privacy and missing usage; delegated ordinary streams retain gates.
- Smallest snapshot/direct guard changes; format, focused and full npm run check.

## Delivery

- Issue/plan, meaningful red, green, contracts/full checks, exact-head AI approval,
  required CI, human-account merge and clean main sync.
- Risk: wider OpenAI history shape; structural support does not certify model
  semantics. Rollback restores refusal rejection. #116 stays open.

## Verification evidence

- Public red: 0 passed, 6 expected failures before implementation.
- Focused history/function green: 43 passed, including actual OpenAI/OpenRouter
  SDK sockets on both bases, delegated ordinary streams and failure delivery gates.
- Own getter fields capture once, credential-await mutations cannot alter upstream
  snapshots, inherited refusal stays absent, and native unsupported markers reject
  before secrets. Missing usage remains unknown without inferred zero counts.
- Existing no-text unknown-field rejection now uses malformed refusal rather than
  a newly supported valid string; other malformed fields/tool integrity stay covered.
- Final npm run check passed type checking, linting, 1,500 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. Evidence-only
  plan changes also pass the planning checker. No fresh OpenRouter comparison.
