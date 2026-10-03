# Detail-only non-streaming reasoning completions

## Issue and problem

- Issue: #302; release gate #116 remains open.
- Valid assistant responses with missing/null content and only reasoning_details
  fail even though the SDK permits these fields independently.

## Scope and expected behavior

- Direct OpenAI/delegated OpenRouter accept stop/length with missing/null content
  and at least one validated nonempty summary, text or encrypted data payload.
- Normalize omitted content to null and preserve the immutable detail snapshot.
- Empty/null payloads and metadata/signature-only details never grant success;
  malformed content/details/finish/tool semantics remain rejected.
- Authentication, model/provider IAM, limits, required audit/ledger, safe failure
  and missing usage controls remain shared. No operational detail disclosure.
- No decryption/signature verification, token inference, native thinking/history
  or additional streaming support; full #116 conformance remains open.

## Design

- Extend the existing reasoning-only content guard using already-validated frozen
  detail values. Check payload presence, never interpret opaque data.
- Reuse existing scalar success and refusal/filter/tool branches unchanged.
- Update detail/scalar contracts, acceptance, architecture and compatibility
  inventory; no new domain terms or costly irreversible decisions/ADRs.
- Sources: installed SDK assistant/choice schemas and reviewed pin v16. This
  nonempty payload rule is a bounded gateway constraint, not a provider guarantee.

## TDD plan

- Public HTTP success with each payload variant, stop/length, both route kinds
  and prefixes should initially fail 502 instead of 200.
- Empty/signature-only data, malformed content, incompatible finish semantics,
  actual SDK sockets, once-captured detail getter and mutation-safe snapshots.
- Authentication/model-provider Deny/limits, required persistence failures and
  missing usage must preserve safe delivery and one per-attempt accounting.
- Focused tests then npm run check; pin/source structures do not change.

## Delivery

- Issue/plan, test red, minimal guard green, full checks, exact-head review/CI,
  authorized account merge and clean main synchronization.
- Risk: an opaque encrypted payload is not visible text or verified reasoning;
  preserve it without authenticity/output-completeness claims. Revert the guard
  to roll back this bounded allowance. Record evidence and risks in the PR.

## Verification evidence

- Initial public HTTP/SDK/detail snapshot red: 31 passed, 5 expected failures
  (502 instead of successful detail-only response and missing normalizer result).
- Focused scalar/detail reasoning green: 37 passed, no failures.
- Payload-only success covers every variant, both route kinds, both prefixes,
  stop/length, omitted/null content and missing/complete usage.
- SDK sockets cover both clients/bases; metadata-only, invalid semantics, inherited
  fields, immutable capture and required persistence/accounting remain covered.
- Pin/projector unchanged; full npm run check results are recorded in the PR.
