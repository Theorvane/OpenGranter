# Bounded Gemini dotted definition keys

Issue #614, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Allow literal ASCII dots after the initial letter/underscore in root-$defs keys and matching local JSON Pointer references, preserving the existing 1..64 character bound. The official Gemini GenerationConfig responseJsonSchema documentation lists $defs/$ref (https://ai.google.dev/api/generate-content?hl=en); JSON Schema structuring uses local definition pointers (https://json-schema.org/understanding-json-schema/structuring). This remains a bounded transport subset, not a claim of live acceptance or schema equivalence. No URI decoding, pointer escapes, normalization, remote fetch, nested definitions, root/nested anchors or output validation. Keep anchor grammar, canonical cycles, unused-definition checks, depth16/shared20,000 visits/128 definitions, IAM/limits/accounting/privacy unchanged. No pins/dependencies/storage/#561 changes. Full #116 and unresolved #7 stay open.

## TDD and delivery

Issue and plan precede tests/source. Extend immutable both-base HTTP/actual SDK/native stream and failure-boundary fixtures with dotted pointer keys, including anchor aliases. Add exact64/65, literal-vs-encoded/malformed/dangling names, cycles, unused definitions and strict/tool/Anthropic pre-secret rejection. Record meaningful red then minimal production delta. Run focused tests, standard taskset-c0,1 npm run check, docs/pins/diff checks; do not weaken failures. Formal exact-head APPROVED and all CI success required before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Meaningful red:266passed,17failed (16 new dotted-key HTTP/SDK/native-stream/failure-boundary variants and one validator probe). Minimal two-regex production delta:283passed. Removed one obsolete dotted-key rejection fixture because it is now explicitly supported; malformed/encoded/dangling cases remain covered. Final focused four-file selection396passed after adding exact depth/count/shared-visit limits and pre-secret negative cases.

- Standard taskset-c0,1 npm run check FAILED:8,449passed,3file-level SIGKILL failures,1optional external PostgreSQL skip (~251seconds). Failed files:migrated-postgres-server,postgres-dual-http-server,postgres-sso-management-http. No reported assertion failures; NOT a local full pass. Types and lint passed (existing42warnings85infos). The2GiB cgroup and cumulative oom_kill338 (previous run334) are consistent with resource pressure, not per-process proof. No full-suite retry, assertion/deadline/concurrency weakening or replacement-pass claim. Source/tests unchanged after this gate.
- Separate planning/link/contracts/fixture-secret scan, all six offline schema integrity checks and whitespace scan passed. Logs:/tmp/opengranter-614-{red,green,format,focused,full,docs,pins}.log. Local Docker/bridge/systemd/live-provider behavior remains unverified.
