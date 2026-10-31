# Bounded nested Gemini anyOf transport

Issue #582, refs #116 and the native mapping gap in [plan552](552-ai-sdk-structured-output.md). On strict:false explicitly object-root schemas, accept nested anyOf with 1..16 recursively validated branches, including anyOf-only nodes with title/description. Typed nodes may also use anyOf; existing type-specific constraints remain. Count every branch against depth<=16. Unknown keys, malformed/empty/oversized lists, and untyped non-union nodes reject before secrets. No oneOf, references, strict/tool composition, generated-output validation or satisfiability guarantee.

Source inspected2026-11-01 KST: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists anyOf for responseJsonSchema. That transport is deprecated in favor of responseFormat; no live model certification. Preserve IAM, limits, immutable nonstream/native text streams, audit/usage/privacy. No pins/dependencies/storage/Anthropic/#561 edits. Keep #116/#7 open. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md), [inventory](../openrouter-compatibility.md).

## TDD and gates

English plan before tests/code. Capture failing public/SDK/native-stream and malformed/depth tests, minimal pure validator patch, focused green and standard full npm run check. Record resource failures as failures, no retry loop or weakened tests. Exact-head all CI success and independent formal GitHub approval required before merge.


## Verification evidence

- Before production edits:62 pass/4 expected failures; expanded63 pass/5 expected failures. Minimal validator patch permits recursive anyOf while keeping explicit object root, typed constraints, keyword and depth limits.
- Focused response-format, native Google text-stream and AI SDK structured suites:181 passed,0 failed. Typecheck and lint passed (existing42 warnings/66 informational diagnostics). Documentation/contracts/links/secret checks and all six offline schema integrity checks passed; pins unchanged.
- Standard full npm run check FAILED:8,212 passed,6 file-level SIGKILL failures,1 optional external PostgreSQL skip (~225s). Failures:postgres-gateway-audit, postgres-sso-management-http, postgres-token-management, postgres-usage-ledger, postgres-usage-reader and proxy-token-lifetime-caps. No assertion failure reported; this is NOT a passing local full gate. No deadline weakening or repeated full-suite loop. Logs:/tmp/opengranter-582-{red,red-expanded,green,focused,check}.log.
- Exact-head full CI and independent formal approval remain required. No local Docker/bridge/systemd, live-provider or complete #116/#7 certification.
