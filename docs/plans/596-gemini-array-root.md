# Bounded Gemini array-root response schemas

Issue #596, refs #116 and the native mapping gap in [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend explicit strict:false schema transport to literal array roots in addition to literal object roots. Preserve the captured schema unchanged. Existing items/prefixItems, min/maxItems, nested unions, root-only definitions and sole-key local references retain all bounds: expanded depth<=16 and shared 20,000 visits. Root scalars, nullable/type-array roots, untyped union/reference roots, strict/tool/Anthropic combinations remain unsupported before credentials. No inlining, URL resolution, output validation, array output guarantee or live-provider certification. No pins/dependencies/storage/#561 changes.

Official GenerationConfig inspected 2026-11-01 KST: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists type/items/prefixItems without an object-only root requirement. The deprecated responseJsonSchema transport is unchanged; this remains a conservative local subset, not full JSON Schema equivalence. Full #116 and unresolved #7 stay open.

## TDD and delivery

Plan recorded in checkout before tests/code. Add meaningful red immutable both-base transport, real SDK sockets and native text stream probes plus IAM/limits/accounting/persistence/privacy checks. Replace the superseded root-array rejection assertion with acceptance; retain malformed root and recursive boundary negatives. Implement minimal root guard change only after red. Run focused suites, types/lint/docs/pins and standard full npm run check, retaining any local resource failures. Exact-head formal independent GitHub approval and all CI success required before normal merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Meaningful pre-source red:105 passed and5 expected failures (new both-base immutable transport, IAM/persistence, actual SDK sockets, native stream, and the superseded prefixItems root assertion). Minimal root guard change resolved the new functionality; two other historical array-root rejection expectations were updated to accepted behavior or an actually unsupported child keyword. Final format suite111passed; integrated format/native stream/SDK structured selection244passed, zero failures.
- Fixtures cover actual array text through installed OpenAI SDK sockets and native text streaming. Persistence/denial fixtures can still return object text deliberately: no generated-output validation or guarantee is implied.
- Standard full npm run check with two CPU affinity under2GiB FAILED:8,198 passed,10 file-level SIGKILL failures, one optional external PostgreSQL skip (~210seconds). No reported assertion failures. Failed files: model-descriptive-metadata; postgres-dual-http-server; postgres-gateway-runtime; postgres-http-server; postgres-model-catalog; postgres-policy-simulator; postgres-sso-management-http; postgres-usage-reader; proxy-token-lifetime-caps; sso-token-management. This is NOT a local full pass. No retries, weakened checks, concurrency or deadline changes. Exact-head full CI remains mandatory.
- Typecheck/lint passed in the standard gate (existing42warnings66infos). Separate planning/link/contract/fixture-secret scan and all six offline integrity checks passed. Whitespace passed. Logs:/tmp/opengranter-596-{red,green,negatives,focused,full,type,format,docs,pins}.log. No local Docker/bridge/systemd/live-provider certification. Final docs-only evidence additions follow these checks.
