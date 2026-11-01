# Bounded Gemini numeric schema constraints

## Issue and scope

Issue [#576](https://github.com/Theorvane/OpenGranter/issues/576), refs #116 and [native mapping gap](552-ai-sdk-structured-output.md), follows merged #575. Extend the [transport subset](572-gemini-response-schema.md) and [enums](574-gemini-schema-enums.md) only with minimum/maximum on explicitly typed number/integer nodes. Bounds must be finite numbers, and a supplied pair must be ordered (equality allowed). Fractional bounds on integers retain JSON Schema semantics and are not rounded. No enum cross-validation or generated-output enforcement is added. Reversed pairs are a conservative local restriction; impossible integer intervals are still transport, not satisfiability certification.

Source inspected 2026-11-01 KST: [GenerationConfig](https://ai.google.dev/api/generate-content?hl=en#v1beta.GenerationConfig) lists minimum/maximum for responseJsonSchema; its deprecation in favor of responseFormat remains a limitation. Local reference /tmp/opengranter-576-google-reference.html is not a pin. No exclusive bounds, coercion, other keywords, tools, strict equivalence, live-model certification, Anthropic changes, dependencies/pins/storage or #561 edits.

See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [format contract](../../contracts/client-response-formats.md).

## TDD and design

Add both-base exact immutable forwarding and boundary tests before production edits, record expected red, then minimally extend the pure validator without serializer changes. Cover negative/fractional/zero/equal/one-sided/extreme finite bounds and malformed/inappropriate/reversed pairs before secrets. Exercise actual installed SDK sockets, native text streams, IAM/limits/persistence/privacy. Keep strict:false, object root and all existing limits/snapshot rules.

## Delivery

Run focused tests, types, lint, documentation/contract/secret and all six offline integrity checks, then standard full npm run check. Record resource failures honestly without weakening deadlines or asserting a full pass. Require exact-head green CI and independent formal GitHub approval before merge. #116/#7 remain open; no live provider, local Docker, bridge or systemd acceptance claim.

## Verification evidence

- Initial focused red:43 passed,4 expected failures on numeric-bound forwarding, SDK and stream transport against the unchanged validator. The minimal17-line validator extension made all47 pass.
- Expanded native format/Google stream/AI SDK structured selection:146 passed,0 failed. Boundary coverage includes one-sided/equal/negative/fractional/extreme bounds, integer fractional/empty intervals and disjoint enum transport, malformed/nonfinite/wrong-type/reversed inputs, SDK sockets, mutation, IAM/limits/persistence/privacy. A provisional negative-zero assertion was corrected to the existing JSON serialization semantics (negative zero becomes zero); no production serializer change was made.
- Typecheck, lint, documentation/planning/contract/fixture-secret checks and all six offline pin checks passed. Existing42 lint warnings/66 infos remain. Pins/dependencies unchanged.
- Standard full npm run check under two-CPU affinity and2GiB memory FAILED:8,160 passed,12 file SIGKILL failures,1 optional external PostgreSQL skip (~231 seconds). All12 failures are process kills rather than assertion failures; this is not a green full local gate. No deadlines/assertions were weakened and no local retry loop is used. Exact-head full CI remains mandatory.
- Logs: /tmp/opengranter-576-{red,green,focused-final,lint,check}.log. No live-model, local Docker, bridge or systemd execution in this slice.
