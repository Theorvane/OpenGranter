# Bounded Gemini dotted anchor names

Issue #612, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend definition-local anchor names and local named references to allow ASCII dots after the initial letter/underscore within the existing 1..64 character bound. Definition names and pointer grammar remain unchanged; dots are literal, not path or URI normalization. Primary sources: https://ai.google.dev/api/generate-content?hl=en lists $anchor/$ref; https://json-schema.org/understanding-json-schema/structuring describes named anchors. Preserve canonical cycles, validation of unused definitions, depth16/shared20,000 visits/128 definitions, immutable nonstream/native-stream transport and IAM/limits/accounting/privacy. No root/nested anchors, $id, URI decoding, remote fetch, generated-output validation, equivalence or live-provider certification. No dependencies/pins/storage/#561 changes; broad #116 and unresolved #7 remain open.

## TDD and delivery

Plan exists before tests/source. Extend existing immutable HTTP, actual SDK and native stream fixtures with dotted direct and alias names, test strict/tool/Anthropic pre-secret rejection, malformed names, distinct literal names, canonical cycles and exact64/65 limits. Record meaningful red before minimal source delta. Run focused tests and standard taskset-c0,1 npm run check without weakening assertions/deadlines/concurrency; disclose any failures. Exact-head independent formal approval and all CI success before normal merge. No local Docker/bridge/systemd/live certification.

## Verification evidence

- Plan written and verified in actual checkout before tests/source. Meaningful format red:249passed,16expected dotted direct/alias transport failures. Minimal two-regex source delta:265passed. Added literal names, exact64/65 bounds, malformed/duplicate/unused/dangling/encoded names, root/nested anchors, canonical mixed cycles and strict/tool/Anthropic pre-secret rejection. Final focused format/native stream/invoker/actual AI SDK structured selection379passed.
- Standard taskset-c0,1 npm run check FAILED:8,441passed,3file-level SIGKILL failures,1optional external PostgreSQL skip (~256seconds). Failed files:migrated-postgres-server,postgres-sso-management-http,postgres-token-management. No reported assertion failures; NOT a local full pass. No full-gate retry or deadline/concurrency/assertion weakening. A single isolated diagnostic selection of exactly those three files also FAILED:18passed,one postgres-sso-management-http file-level SIGKILL. This is not replacement full-suite evidence. The2GiB cgroup and cumulative oom_kill334 are consistent with resource pressure, not per-process proof.
- Full-gate types/lint passed with42warnings85infos. Separate planning/link/contracts/fixture-secret scan, all six offline schema integrity checks and whitespace scan passed. Source/tests unchanged after the full gate; only documentation evidence updated. Logs:/tmp/opengranter-612-{red,green,format,focused,full,docs,pins,sigkill-investigation}.log. No local Docker/bridge/systemd/live-provider certification. Exact-head formal approval and all CI success remain mandatory before merge.
