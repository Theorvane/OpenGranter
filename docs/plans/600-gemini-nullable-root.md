# Bounded Gemini nullable-root response schemas

Issue #600, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false transport to two-member type arrays containing null plus one supported concrete type (object, array, string, number, integer, boolean), in either order. Reuse recursive validation rather than bypassing type/keyword/local-reference/expanded-depth<=16/shared20,000-visit bounds. Transport captured schemas unchanged. Root null, malformed type arrays, untyped union/reference roots, strict/tool/Anthropic combinations remain unsupported before credentials. No output validation, null-output guarantee, satisfiability, schema equivalence or live-model certification. No pins/dependencies/storage/#561 changes; full #116 and unresolved #7 stay open.

Official GenerationConfig: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists type as a supported JSON Schema keyword; the [structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output) describes nullable type arrays. This conservative subset keeps deprecated responseJsonSchema and existing nullable-pair restrictions.

## TDD and gates

Plan before tests/code. Add meaningful red for immutable both-base HTTP, actual OpenAI SDK socket and native text streams, including null text and IAM/limits/accounting/persistence/privacy. Both type orders and all six concrete types; recursive/ref/depth/count and malformed/strict/tool/Anthropic pre-secret negatives. Minimal source change; supersede only root-only negatives. Run focused, full standard check, types/lint/docs/pins without weakening assertions or deadlines. Exact-head formal approval and all CI success before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Meaningful red before source edits:128passed and48expected failures across six concrete types, both type orders, immutable both-base HTTP, IAM/persistence, actual SDK sockets and native streams. Minimal root admission change then passed172/176; three historical nullable-root-only negatives were superseded and a newly added stream assertion corrected to compare escaped JSON text (array quotes must remain intact). No runtime output defect was claimed for that assertion.
- Expanded malformed type-array, keyword, cyclic/external-reference, strict/tool/Anthropic nonstream and Google stream pre-secret probes; nullable-root reference expanded-depth/count/shared-visit boundary coverage. Final focused response-format/native-text-stream/actual-AI-SDK structured selection240passed, zero failures. Both concrete JSON text and literal null text are transported; fixtures do not certify provider output validity.
- Standard full taskset-c0,1 npm run check FAILED:8,282passed,10file-level SIGKILL failures, one optional external PostgreSQL skip (~237seconds). No reported assertion failures. Failed files:migrated-postgres-server,model-count-audit,postgres-anthropic-function-stream,postgres-audit-history,postgres-direct-http-server,postgres-gateway-runtime,postgres-google-functions,postgres-model-catalog,postgres-sso-management-http,sso-token-management. NOT a local full pass; no retry/concurrency/deadline/assertion weakening. Cgroup memory.max is2GiB and cumulative memory.events contains OOM kills, consistent with resource pressure but not per-test proof of cause.
- Typecheck/lint passed (42warnings67infos); separate planning/link/contracts/fixture-secret scan, all six offline pinned schema checks and whitespace passed. Logs:/tmp/opengranter-600-{red,green,negatives,focused,full,format,docs,pins}.log. Only documentation evidence added after full validation. No local Docker/bridge/systemd/live-provider certification. Exact-head full green CI and independent formal approval remain mandatory.
