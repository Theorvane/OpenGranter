# Assistant function response capture consistency

## Issue and problem

- Issue: #340. Assistant response normalization rereads call IDs, function names,
  arguments, call-array lengths and legacy function_call between validation and
  projection. Local accessors can project invalid types or bypass the 128-call cap.
- HTTP JSON cannot contain accessors. This is a public helper/provider-boundary
  consistency defect; no network exploit or credential disclosure is claimed.

## Scope and expected behavior

- Capture call-array length/positions and used call/function fields once; validate
  and project the same captured values. Capture legacy function_call once.
- Preserve one to 128 calls, unique nonempty IDs/names, exact string arguments,
  inherited scalar fields, unknown-field omission and finish/content/refusal gates.
- Sanitize response-normalization exceptions at both provider boundaries; retain
  possibly-billed failed-attempt accounting and metadata privacy.
- No new accepted JSON, routing authority, stream/native support or schema pin.
  IAM, explicit Deny, limits and required persistence remain shared; #116 stays open.

## Design

- Validate one captured length and snapshot fixed indexed entries before reading
  call getters. Capture each used field into constants; retain existing projection.
- Catch delegated normalization failures alongside JSON decoding, matching direct
  transport's sanitized failure path. Do not retry malformed first captures.
- Snapshot timing does not guarantee atomic arbitrary object graphs or certify
  arbitrary Proxies. No domain decision or ADR is needed for this reversible fix.
- Update the function response contract, acceptance and compatibility documents.

## TDD plan

- Public regressions first fail for repeated fields, legacy control and length/entry
  drift; malformed first values and duplicate IDs must reject.
- Provider-boundary injected response objects cover success, invalid first fields,
  throwing getters and privacy/accounting on both compatible HTTP bases.
- Preserve unknown/inherited projection, response content/reasoning/refusal gates,
  existing SDK, authorization denial, limit and persistence scenarios.
- Minimum capture/catch implementation, focused tests, format and npm run check.

## Delivery

- Issue/plan before implementation; record red/green evidence, full checks and risks
  in the PR; exact-head AI approval, required CI and human-account squash merge.
- Risk: local programmatic capture timing changes. Accepted JSON remains unchanged;
  rollback would restore validation/projection inconsistency.

## Verification evidence

- Public regression red: 1 pass, 4 expected failures for repeated scalar/legacy
  captures, count drift and unsanitized delegated normalization exceptions.
- Injected HTTP response boundary red: 10 passes, 2 expected failures for invalid
  projected arguments. Focused response/SDK/reasoning/refusal/no-text green: 75.
- Full npm run check: strict types and lint passed; 1,539 tests passed with one
  existing PostgreSQL skip; planning/contracts/fixture scan and offline pin passed.
- Both bases retain exact captured output or safe invalid/throwing failure with
  possibly-billed usage and metadata privacy; existing IAM/Deny/limits/persistence
  gates remain green. Evidence-only plan update passes the planning checker.
