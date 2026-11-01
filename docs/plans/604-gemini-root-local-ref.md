# Bounded Gemini root local references

Issue #604, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false transport to root $ref plus root-only $defs, with no other reference siblings. Reuse simple #/$defs/name references, validation of every definition including unused entries, cycle rejection, expanded depth<=16 and shared20,000-visit budget. Preserve schemas without inlining or URL fetching. Resolved targets use the existing recursive subset (including nullable/unions/null); literal root null remains unsupported. Strict/tool/Anthropic, nested definitions, malformed/external/dangling/escaped refs and other siblings stay pre-secret failures. No generated-output validation, schema equivalence, satisfiability or live-provider certification. No pins/dependencies/storage/#561 edits; full #116 and unresolved #7 remain open.

Official source: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig documents $ref/$defs and sibling restrictions; responseJsonSchema remains deprecated.

## TDD and delivery

Plan written in actual checkout before tests/source. Red both-base immutable HTTP, actual SDK sockets, native text streams and admission/persistence/privacy. Cover direct/chained refs, scalar/object/array/union/nullable targets, prototype-like own names, expanded depth/budget/counts, malformed/unused/cyclic and strict/tool/Anthropic rejection. Minimal source fix then focused tests and standard full npm run check without assertion/deadline/concurrency weakening. Record local failures honestly. Exact-head formal independent approval and all CI success required before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Meaningful red before source edits:198passed,16expected failures in new both-base immutable HTTP, actual OpenAI SDK socket, native text-stream and admission/persistence tests. Minimal two-guard production edit then210/214passed; four historical root-ref-only negatives were superseded with genuinely unsupported missing targets/child keywords. No unrelated negative removed.
- Expanded direct/chained object/nullable transport plus scalar/array/union/null target acceptance, prototype-like own names, exact expanded-depth/count/name bounds, shared traversal budget, cycles/unused/dangling/external/escaped/sibling rejection and strict/tool/Anthropic pre-secret guards. Format217passed; final format/managed-text-stream/actual AI SDK structured selection279passed, zero failures. Object and literal-null outputs are fixture transport only, not output enforcement or live certification.
- Standard full taskset-c0,1 npm run check FAILED:8,398passed,2file-level SIGKILL failures and one optional external PostgreSQL skip (~260seconds). Failed files:postgres-dual-http-server and postgres-sso-management-http. No reported assertion failures. NOT a local full pass; no retries or concurrency/deadline/assertion weakening. Cgroup memory.max2GiB and cumulative OOM kills are consistent with resource pressure but not per-test proof.
- Typecheck/lint passed (existing42warnings67infos). Separate planning/link/contracts/fixture-secret scan and all six offline pinned-schema integrity checks passed; whitespace passed. Logs:/tmp/opengranter-604-{red,green,negatives,focused,full,type,format,docs,pins}.log. Evidence-only docs updated after full gate; final doc scan rerun before PR. No local Docker/bridge/systemd/live-provider certification. Exact-head independent formal approval and all CI success remain mandatory.
