# Bounded non-strict Gemini response JSON schemas

## Issue and problem

Issue [#572](https://github.com/Theorvane/OpenGranter/issues/572), refs #116 and the native schema mapping gap in [#552](552-ai-sdk-structured-output.md). Direct Gemini currently rejects every json_schema request before credentials.

## Scope and expected behavior

Accept only explicit strict:false with a supplied object-root schema on direct Gemini text requests. Preserve the captured schema exactly as generationConfig.responseJsonSchema with responseMimeType application/json. Support recursively typed object/array/string/number/integer/boolean/null nodes, description/title, properties, required, boolean additionalProperties and array items. Reject unknown keywords, inappropriate keyword/type combinations, malformed required lists, missing array items, absent schemas, other strict values and any tool controls before credentials. Name and outer description are compatible format labels, not native instructions. No rewriting, output repair/validation, strict-equivalence claim, native Anthropic change, tool/schema composition, new routing policy, pins, dependencies or storage changes.

## Design

Use the shared immutable response-format snapshot and a pure conservative native validator before secret access. Text stream and nonstream share direct transport. Existing OpenAI/OpenRouter behavior and Gemini text/json_object remain unchanged. Keep complete model/provider IAM, limits and required audit/usage; upstream acceptance is model dependent and refusals/truncation are unchanged.

Source inspected 2026-11-01 KST: [Google GenerateContent GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig). It describes responseJsonSchema and its limited keyword set plus required MIME type; the older schema field is deprecated in favor of responseFormat. This slice deliberately uses the existing GenerateContent configuration family, not Interactions or a claim of latest-model support. A local reference snapshot is /tmp/opengranter-572-google-reference.html (not a repository pin).

See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [format contract](../../contracts/client-response-formats.md), [compatibility inventory](../openrouter-compatibility.md).

## TDD plan

First add both-base Gemini HTTP success and exact native forwarding tests, which must fail on current rejection. Include mutation during secret resolution, unsupported keyword/strict/tool pre-secret rejection, IAM/limit denial, persistence failure and private operational records. Then implement the narrow validator/serializer; run focused format/native/stream tests, types, lint and repository checks. Do not claim local full checks when resource failures occur.

## Delivery

Issue and plan precede tests/code. Publish red/green, exact-head full CI and independent GitHub review before merge. Static/native mock tests are not live model or production acceptance. Rollback restores Gemini json_schema rejection. Full #116 and unresolved #7 remain open; #561 is untouched.

## Verification evidence

- Initial focused red: two expected failures (success and persisted-failure boundary still returned502), one rejection case passed. After minimal native transport implementation, all35 format tests passed.
- Added a type-array coercion regression: one expected failure before requiring string types; fixed without broadening schema semantics.
- Final focused format, native Gemini stream and AI SDK structured-output selection:135 passed, zero failed. Actual OpenAI SDK sockets cover both bases; native streaming asserts exact pre-secret schema capture and reported usage.
- Typecheck and lint passed in the standard check (existing lint diagnostics remain). Full npm run check with two-CPU affinity under the2GiB cgroup did NOT pass:8,142 passed,11 failed, one skipped (10 existing file SIGKILLs and the existing service child-readiness probe failure under pressure). Assertions and deadlines were not weakened. This is not a local full-gate pass; exact-head full CI is required.
- The initially installed npm distribution could not load walk-up-path; extracted the existing Node22.23.4 ARM64 archive into a private /tmp tools directory after matching its SHA256 to the saved SHASUMS. No repository dependency or lockfile changed.
- Source/document/planning/contract/fixture-secret checks and pinned integrity checks are run separately; no Docker, live provider or installed systemd acceptance is claimed.

- Isolated unchanged service CLI suite after full-run workers exited:3passed, zero failed. Planning/links/contracts/fixture-secret scan, six pinned integrity checks and whitespace check passed. No full-suite success is inferred from this rerun.
