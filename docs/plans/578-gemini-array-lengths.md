# Bounded Gemini array schema lengths

## Scope and references

Issue [#578](https://github.com/Theorvane/OpenGranter/issues/578), refs #116 and the [native mapping gap](552-ai-sdk-structured-output.md), follows merged #576/#577. Extend only strict:false object-root Gemini responseJsonSchema transport with minItems/maxItems on explicitly typed array nodes. Require nonnegative safe integer values and ordered pairs (equality allowed), including nested arrays. This is a conservative representable subset, not schema satisfiability or generated-output validation.

Source inspected 2026-11-01 KST: [GenerationConfig](https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig) lists minItems/maxItems for responseJsonSchema; deprecation in favor of responseFormat remains a limitation. This is JSON Schema numeric length transport, not the separate Schema int64-string representation. Local source /tmp/opengranter-array-reference.html is not a pin.

See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/client-response-formats.md) and [compatibility inventory](../openrouter-compatibility.md). No new dependencies/pins/storage, strict equivalence, other keywords, Anthropic changes, #561 edits, live-provider or operational certification. Keep #116/#7 open.

## TDD and validation

Add failing forwarding/SDK/stream regressions before the minimal pure validator change. Test both bases, zero/equal/one-sided/safe integer edges, wrong types/negative/fractional/unsafe/nonfinite/reversed values, pre-secret failures, snapshot mutation and IAM/limits/persistence/privacy. Existing serializers and limits remain unchanged.

Run focused tests, types, lint, docs/contracts/secrets and offline schema pins, then standard full npm run check. Record resource failures honestly; no weakened deadlines or retry loop. Require exact-head full CI and independent formal GitHub approval before merge.

## Verification evidence

- Before production edits, the original validator produced49 passes/4 expected forwarding, SDK and stream failures. Expanded edge cases produced50 passes/5 expected failures. After the minimal18-line pure-validator change, all55 response-format cases passed.
- Standard full npm run check passed types and lint (existing42 warnings/66 informational diagnostics) but FAILED:8,174 passed,6 file-level SIGKILL failures,1 optional PostgreSQL skip, ~212 seconds. The six failures are process kills, not assertion failures; this is not a passing full local gate. No retry loop or weakened deadlines/assertions. Log /tmp/opengranter-578-check.log.
- Local focused and offline checks are recorded separately; exact-head full CI and independent formal GitHub approval remain mandatory. No live model, local Docker, bridge or systemd certification.

- Expanded response-format/native Google stream/AI SDK structured selection:168 passed,0 failed. Documentation/planning/contract/fixture-secret checks and all six offline schema integrity checks passed; dependencies and pins unchanged. Focused log /tmp/opengranter-578-focused.log.
