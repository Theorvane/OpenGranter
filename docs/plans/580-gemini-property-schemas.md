# Bounded Gemini additional property schemas

## Scope and references

Issue #580, refs #116 and [native mapping gap](552-ai-sdk-structured-output.md), follows merged #579. Extend strict:false object-root Gemini responseJsonSchema transport to schema-valued additionalProperties on explicit object nodes. Validate recursively with the existing keyword/type/depth restrictions; boolean behavior stays unchanged. Nested objects/arrays and enums/numeric/array bounds remain supported; empty/untyped and malformed schemas reject before secrets. No output validation, satisfiability, strict equivalence or live-model guarantee.

Source inspected 2026-11-01 KST: [GenerationConfig](https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig) lists additionalProperties for responseJsonSchema; this transport is deprecated in favor of responseFormat. No pins/dependencies/storage, other providers, #561 edits or operational certification. Keep #116/#7 open. See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md) and [inventory](../openrouter-compatibility.md).

## TDD and validation

Write forwarding, installed SDK socket, immutable native stream, malformed/nested/depth and IAM/limits/persistence/privacy tests first. Record red before the minimal pure validator change, then focused green, typecheck/lint/docs/offline pins and standard full npm run check. Resource/process failures are not a passing local full gate; no weakened deadlines or repeated full-suite loop. Exact-head full CI and independent formal GitHub approval required before merge.

## Verification evidence

- Before production edits: original55 pass/4 expected failures; expanded56 pass/5 expected failures. Minimal validator change adds recursion for additionalProperties. Replaced the now-obsolete valid-schema rejection with an unsupported-pattern rejection; boolean and depth16/17 boundaries have explicit tests.
- Expanded response-format, native Google stream and AI SDK structured tests:175 passed,0 failed. Typecheck, lint (existing42 warnings/66 informational diagnostics), documentation/contracts/secrets and all six offline pins passed.
- Standard full npm run check FAILED:8,175 passed,6 file-level SIGKILL failures,1 optional external PostgreSQL skip (~210 seconds). Not a passing local full gate; no weakened deadlines or retry loop. Logs /tmp/opengranter-580-{red,red-expanded,green,focused,check}.log. Exact-head full CI and independent formal approval still required. No local Docker/bridge/systemd or live-provider certification.
