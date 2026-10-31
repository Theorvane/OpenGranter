# Bounded Gemini property ordering transport

Issue #588, refs #116 and native mapping gap in [plan552](552-ai-sdk-structured-output.md). Extend strict:false explicitly object-root responseJsonSchema with propertyOrdering only on explicitly typed objects: preserve exact ordered lists of 0..128 unique strings naming own declared properties. Empty and partial lists allowed. This count/membership/uniqueness restriction is local; no generated-output ordering enforcement, schema satisfiability or live-model certification. All supported recursive nodes share existing capture/depth<=16 limits. Malformed, unknown, duplicate, oversized and wrong-type lists reject before credentials.

Official source inspected 2026-11-01 KST: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig explicitly permits non-standard propertyOrdering. responseJsonSchema is deprecated in favor of responseFormat. Preserve immutable nonstream/native text-stream transport, IAM/limits, accounting/persistence/privacy. No pins/dependencies/storage/Anthropic/#561 changes; strict/root/tool/reference restrictions remain. Full #116 and unresolved #7 stay open. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md), [inventory](../openrouter-compatibility.md).

## TDD and gates

English plan before tests/code. Red public/SDK/native-stream probes and malformed/depth/count/type boundary checks; minimal validator change; focused green and standard full npm run check. Resource failures are not passes; no retry loops or weakened deadlines. Exact-head all CI success and independent formal approval required before merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Red before production edits: 81 passed / 5 expected failures. Minimal 12-line production delta. Response-format green: 86 passed. Final focused response-format, native Google stream, direct provider invoker and AI SDK structured suites: 183 passed / 0 failed, including strengthened isolated wrong-type and stream pre-secret negative probes after the full run.
- Standard full npm run check FAILED: 8,226 passed, 4 file-level SIGKILL failures, one optional external PostgreSQL skip (~226 seconds). Files: postgres-dual-http-server, postgres-gateway-audit, postgres-sso-management-http, sso-token-management. No assertion failures reported. NOT a local full-gate pass; no retry/concurrency/deadline weakening. Full run preceded final negative-probe strengthening; final focused tests/typecheck/lint passed afterward. Logs: /tmp/opengranter-588-{red,green,focused,full,lint}.log.
- Typecheck/lint passed (existing 42 warnings/66 infos); docs/contracts/links/fixture-secret checks and all six offline schema integrity checks passed; pins unchanged. Exact-head full CI and independent formal approval still required. No local Docker/bridge/systemd/live-provider or complete #116/#7 certification.
