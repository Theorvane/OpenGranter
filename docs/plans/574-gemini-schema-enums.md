# Bounded Gemini schema enums

## Issue and scope

Issue [#574](https://github.com/Theorvane/OpenGranter/issues/574), refs #116 and [native structured-output gap](552-ai-sdk-structured-output.md), follows approved merged #573. Extend the [#572 transport subset](572-gemini-response-schema.md) only with enum on explicitly typed string/number/integer nodes: nonempty, unique, at most128 matching scalar values; numbers must be finite and integer enums integral. The128 bound and duplicate rejection are conservative local restrictions. Object, array, boolean and null enum nodes remain unsupported. Preserve exact schema values and snapshots, strict:false and object root; do not validate generated outputs or claim live-model/strict equivalence.

Source inspected 2026-11-01 KST: [Google GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig) lists enum for strings and numbers under responseJsonSchema. Its deprecation in favor of responseFormat is retained as a transport limitation. No pins, dependencies, migrations, native Anthropic changes or #561 work.

See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [format contract](../../contracts/client-response-formats.md).

## TDD and design

Add failing both-base exact forwarding and pre-secret rejection tests first. Exercise nested arrays, 128/129 boundaries, mutation during secret resolution, stream reuse, actual installed SDK sockets, IAM/limits/persistence/privacy. Extend only the pure captured-schema validator, not the serializer. Run focused tests, types, lint, planning/contract/pin checks and full npm run check. Keep local resource failures distinct from exact-head CI.

## Delivery

Require exact-head full green CI and independent GitHub approval before merge. Do not bypass checks or treat a read-only review as approval. Full #116 and unresolved #7 remain open; no live/provider/Docker/systemd acceptance claim.

## Verification evidence

- Initial focused red:38 passed,2 expected failures on enum forwarding/128-member admission against the unchanged validator. Minimal validator change made all40 pass.
- Expanded focused native-format/Google-stream/AI-SDK structured selection:140 passed,0 failed. Added installed OpenAI SDK both-base sockets, stream snapshot mutation, IAM/limits/persistence/privacy coverage. Mock response text intentionally need not satisfy the supplied enum schema: this transport does not enforce generated output.
- Typecheck and lint passed (existing unrelated diagnostics retained). Planning/link/contract/fixture-secret checks and all six offline pin integrity checks passed; dependencies/pins unchanged.
- Standard full npm run check under two-CPU affinity and2GiB memory did NOT pass:8,125 passed,16 failed,1 optional skip. All16 failures were file SIGKILLs, not assertion failures; no deadlines/assertions were weakened. The standard local full gate is not claimed green. A sequential isolated recheck of exactly these16 files is recorded separately; exact-head full CI remains mandatory.
- Logs: /tmp/opengranter-574-{red,green,focused,check,isolated}.log. No live-model, Docker, bridge or systemd execution in this slice.

- Sequential isolated recheck:408 passed,3 file SIGKILL failures (postgres-gateway-runtime, postgres-sso-management-http, sso-token-management),0 skipped. It also is NOT a green gate and does not erase the standard full failure. No further local retry or unrelated production changes were made.
