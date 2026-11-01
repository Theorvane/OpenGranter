# Bounded Gemini prefixItems transport

Issue #584, refs #116 and the native mapping gap in [plan552](552-ai-sdk-structured-output.md). Extend the strict:false explicitly object-root responseJsonSchema subset with prefixItems only on explicitly typed arrays: 1..16 recursively validated schemas, optional supported items schema, shared depth<=16. Arrays without prefixItems still require items. Empty prefixes and boolean items/branches remain unsupported local restrictions. Preserve exact captured schema; no generated-output validation, tuple satisfiability or live-model certification.

Source inspected2026-11-01 KST: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig explicitly lists prefixItems; responseJsonSchema is deprecated in favor of responseFormat. Preserve IAM, limits, pre-credential rejection, native nonstream/text streams, accounting/persistence and privacy. No pins/dependencies/storage/Anthropic/#561 changes; strict/root/tool/reference restrictions remain. Full #116 and unresolved #7 stay open. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md), [inventory](../openrouter-compatibility.md).

## TDD and gates

English plan before tests/code. Failing public/SDK/native-stream probes, malformed children/bounds/depth checks, minimal validator patch, focused green and standard full npm run check. Report local resource failures honestly without retry loops or relaxed gates. Exact-head all CI success and independent formal GitHub approval before merge.

## Verification evidence

- Red before production edits:68 passed/4 expected failures; expanded69 passed/5 expected failures. Minimal17-line validator delta; no output enforcement.
- Green response-format suite:74 passed. Final focused response-format, native Google text-stream/invoker and AI SDK structured suites:187 passed/0 failed. Typecheck and lint passed after correcting test mutation types/format (existing42 warnings/66 infos). Documentation/contracts/links/secret scan and all six offline schema integrity checks passed; pins unchanged.
- Standard full npm run check FAILED:8,210 passed,6 file-level SIGKILL failures,1 optional external PostgreSQL skip (~209s). Files:postgres-gateway-runtime, postgres-usage-ledger, postgres-usage-reader, proxy-token-lifecycle, proxy-token-lifetime-caps and sso-token-management. No assertion failures reported. This is NOT a local passing full gate; no full-suite retry loop or weakened deadlines. Logs:/tmp/opengranter-584-{red,red-expanded,green,focused-final,full}.log. Earlier type/format preflight failures were corrected before this measured full run.
- Exact-head full CI and independent formal approval remain required. No local Docker/bridge/systemd/live-provider or complete #116/#7 certification.
