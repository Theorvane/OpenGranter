# Function history capture consistency

Public chat history snapshots capture fixed indexed history/call positions before
field validation. Read message role, supplied own tool_calls reference, nested
call ID/type/function reference/name/arguments and result ID once. The same
validated ID drives uniqueness, pending registration/matching and frozen output;
validated names and serialized argument strings are the exact forwarded values.
Invalid first captures reject without retrying getters or coercion.

Array replacement/append during nested validation cannot substitute captured
positions. Snapshot timing does not guarantee atomic frozen arbitrary caller
object graphs before getters execute. Downstream immutable messages/call records
remain stable through credential-await caller mutation.

Preserve dense arrays, the 128-call bound, exact keys, nonempty unique IDs, string
arguments, instruction order and complete matching tool results. Duplicate/orphan/
missing/interrupted results reject. Existing inherited required scalar fields stay
supported; optional reasoning/details/refusal/tool_calls retain own-field rules and
explicit own undefined rejection. No accepted JSON or provider policy expands.

Public getter regressions and direct/delegated adapter tests reproduce the defect
and verify exact payload or safe failure before secrets. HTTP JSON cannot contain
accessors, so no network exploit or credential disclosure is claimed. Existing
HTTP/SDK/auth/model-provider IAM/Deny/limits/required audit and usage/privacy/safe
failure accounting remain shared. Tool histories grant no execution authority.

Pin v18 and existing provider mappings stay unchanged; no fresh source comparison
or complete #116 certification is asserted. Native/rich/tool streams remain open.
See [plan](../docs/plans/336-function-history-capture.md),
[function groups](function-tool-history.md), and
[content-part capture](content-part-capture.md).

Array lengths are captured once for bounds validation and indexed snapshots;
noninteger/negative accessor-backed lengths reject. This does not change genuine
JSON array bounds or certify arbitrary Proxy traps.
