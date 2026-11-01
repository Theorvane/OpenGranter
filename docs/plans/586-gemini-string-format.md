# Bounded Gemini string format annotations

Issue #586, refs #116 and [plan552](552-ai-sdk-structured-output.md). Extend strict:false explicitly object-root responseJsonSchema with format on explicitly typed strings only: exact 0..256 UTF-16 units, including empty, whitespace and unknown names. Existing capture caps and depth<=16 remain. All other types and non-string/oversized annotations reject before credentials. This is opaque annotation transport, not validation, format enforcement, satisfiability or live-model support.

Official source inspected 2026-11-01 KST: https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig lists format without an enum; responseJsonSchema is deprecated in favor of responseFormat. String-only and length caps are conservative local restrictions. No format-driven conversion or authorization. Preserve native nonstream/text streams, IAM/limits, accounting/persistence/privacy. No pins/dependencies/storage/Anthropic/#561 changes; full #116 and unresolved #7 stay open. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md), [inventory](../openrouter-compatibility.md).

## TDD and gates

Plan before code; red public/installed SDK/native-stream probes plus malformed annotation pre-secret and depth/type boundary tests; minimal validator patch; focused green and standard full npm run check. Resource failures are not successes; no retries or weakened deadlines. Exact-head all CI success and independent formal approval required before merge. No local Docker/bridge/systemd/live-provider certification.

## Verification evidence

- Red before production edits: 75 passed / 5 expected failures. Minimal 6-line validator delta. Response-format green: 80 passed / 0 failed. Expanded UTF-16/undefined/depth/root/strict boundaries included in final focused run: 177 passed / 0 failed across response formats, native Google streams, direct provider invokers and AI SDK structured output.
- Standard full npm run check FAILED: 8,209 passed, 8 file-level SIGKILL failures, one optional external PostgreSQL skip, ~221 seconds. No assertion failures reported. Files: postgres-iam-snapshots, postgres-sso-management-http, postgres-token-management-service, postgres-usage-ledger, postgres-usage-reader, proxy-token-lifecycle, proxy-token-lifetime-caps, sso-token-management. This is NOT a passing local full gate; no retries, concurrency changes or weakened deadlines. Logs: /tmp/opengranter-586-{red,green,focused,full}.log.
- Typecheck and lint passed before full tests (existing diagnostics only). Documentation/contracts/links/fixture-secret checks and all six offline pinned schema integrity checks separately passed after the full run stopped. Pins remain unchanged. Exact-head all CI and formal independent approval are still required.
- No local Docker/bridge/systemd/live-provider or complete #116/#7 certification.
