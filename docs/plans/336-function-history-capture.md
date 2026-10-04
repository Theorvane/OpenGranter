# Function history capture consistency

## Issue and problem

- Issue: #336. Public history snapshots repeatedly read role/tool_calls, nested
  call ID/name/arguments and result ID between validation, matching and projection.
- Local getters reproduce numeric arguments/name after string checks and result
  IDs differing from the matched pending ID. HTTP JSON cannot contain accessors;
  no network exploit or credential disclosure is claimed.

## Scope and expected behavior

- Capture fixed indexed message/call positions and every used scalar/reference once;
  use the same values for validation, uniqueness, pending registration and output.
- Preserve exact allowed keys, dense arrays, maximum 128 calls, nonempty unique IDs,
  serialized string arguments, instruction order and complete pending result groups.
- Keep own optional markers and explicit own undefined rejection. Preserve existing
  inherited required scalar fields instead of silently changing compatibility.
- Invalid first capture rejects without retries pre-secret; immutable downstream
  histories resist credential-await mutation. No JSON/provider/policy/schema change.
- Full auth/IAM/Deny/limits/required audit/usage/privacy/safe failure behavior stays
  shared. History grants no tool execution authority; #116 remains open.

## Design

- Snapshot array positions before validating any nested fields. Capture nested
  call scalars/function reference once, then validate/project frozen primitives.
- Read role once before type checks; read tool_calls only at its own assistant
  branch, and result ID once for pending deletion and output.
- Existing reasoning/refusal/detail single captures remain; fixed sequences do not
  promise atomic frozen arbitrary caller object graphs before getter execution.
- No new glossary/ADR decision; reversible consistency fix. Update history contract,
  architecture, acceptance and compatibility capture documentation.

## TDD plan

- Public getter regression first fails: invalid second arguments/name must never
  replace the validated first string; call/result IDs must retain matched values.
- Role/call-array getters and array replacement/append use first captured sequence.
- Invalid first values/duplicates/orphans/incomplete/sparse/oversized arrays reject;
  own undefined/inherited boundaries remain covered.
- Direct/delegated adapter tests assert exact nested payload and secret-await
  immutability, unsupported native guards and sanitized accessor failures pre-secret.
- Existing HTTP/SDK history and security/accounting suites; format/full npm run check.

## Delivery

- Issue/plan, meaningful regression red, minimum capture fix, focused/full checks,
  exact-head AI review, required CI, human-account merge and clean main sync.
- Risk: capture timing changes only accessor-backed input. Accepted JSON shapes and
  shared provider/policy contract stay unchanged; rollback reopens repeated reads.

Array lengths are captured once for bounds validation and indexed snapshots;
noninteger/negative accessor-backed lengths reject. This does not change genuine
JSON array bounds or certify arbitrary Proxy traps.

## Verification evidence

- Initial public regression red: 1 passed, 5 expected failures for repeated field/
  reference reads, changed result matching and mutable array positions.
- Supplemental length regression red: 6 passed, 1 expected failure after minimum
  capture changes; validation and indexed snapshots now share a single length.
- Final focused history/function/SDK green: 52 passed. Direct/delegated payloads
  retain exact matched IDs/function strings through credential-await mutation;
  malformed first values and throwing accessors fail safely pre-secret.
- Final npm run check passed strict types, linting, 1,521 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. Evidence-only
  plan update also passes the planning checker; no JSON/provider/schema expansion.
