# Bounded Gemini scalar-root response schemas

Issue #598, refs #116 and the native mapping gap in [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false schema transport to literal string, number, integer and boolean roots. Preserve exact captured schemas and all recursive keyword/type/reference/depth<=16 and shared20,000-visit restrictions. Root null, nullable/type-array, untyped union/reference roots and strict/tool/Anthropic combinations remain unsupported before credentials. No output validation, scalar output guarantee, satisfiability or live-provider certification. No pins/dependencies/storage/#561 changes. Full #116 and unresolved #7 remain open.

Official GenerationConfig: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists type and scalar restrictions without an object/array-only root rule. This conservative subset retains deprecated responseJsonSchema, not complete JSON Schema semantics.

## TDD and delivery

Plan recorded before tests/code. Add meaningful red both-base immutable transport, actual SDK sockets, native text streams and IAM/limits/accounting/persistence/privacy probes; scalar-specific valid/invalid constraints and pre-secret rejection for unsupported roots/strict/tools/Anthropic. After red implement minimal root guard and supersede historical scalar-root-only rejections. Run focused, types/lint/docs/pins and standard full check, retaining resource failures rather than claiming full success. No local Docker/bridge/systemd/live-provider certification. Exact-head formal approval and all CI success precede normal merge.

## Verification evidence

- Meaningful pre-source red:111passed,4expected failures for new string-root immutable HTTP, IAM/persistence, installed SDK sockets and native stream probes. Minimal root guard resolved these; two historical root-only rejection tests were superseded. Expanded coverage then exercised all four scalar roots and malformed/recursive/strict/tool/Anthropic pre-secret boundaries. Final integrated format/native-stream/AI-SDK structured selection190passed, zero failures (format128).
- Actual SDK and native stream fixtures return scalar JSON text; persistence/error fixtures deliberately may return object text. Server output validation or guarantees are not claimed.
- Standard full npm run check on two CPU affinity FAILED:8,223passed,11file-level SIGKILL failures, one optional external PostgreSQL skip (~221seconds). No reported assertion failures. Failed files:migrated-postgres-server,model-discovery-metadata,postgres-direct-http-server,postgres-dual-http-server,postgres-google-function-stream,postgres-google-stream,postgres-sso-management-http,postgres-token-management,proxy-token-lifecycle,proxy-token-lifetime-caps,sso-token-management. This is NOT a local full pass; no retries, deadline/concurrency/assertion changes or bypass. Full exact-head CI remains mandatory.
- Typecheck/lint passed in standard gate (42warnings67infos). Separate planning/link/contracts/fixture-secret scan, all six offline integrity checks and whitespace passed. Logs:/tmp/opengranter-598-{red,green,negatives,focused,full,format,docs,pins}.log. No local Docker/bridge/systemd/live-provider certification. Only documentation evidence was added after the full gate.
