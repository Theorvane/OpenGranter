# Upstream Refusal Outcomes

## Issue and problem

- Issue: [#146](https://github.com/Theorvane/OpenGranter/issues/146).
- OpenAI and OpenRouter adapters reject legitimate null-content refusals and discard refusal/filter signals, breaking external SDK interpretation.

## Scope and expected behavior

- Non-streaming OpenAI and OpenRouter single-choice responses preserve assistant string/null content, optional string/null refusal, and content_filter finish reason.
- Null content requires a nonempty refusal or content_filter; missing content and malformed refusal remain upstream failures.
- Anthropic/Gemini refusal mapping, tool calls, streaming, content auditing storage and full response-schema coverage remain out of scope.
- Authentication, destination IAM, limits and required audit precede invocation. A delivered refusal is a successful delivery with ordinary usage accounting, not an IAM denial. Never retry it or put refusal/text into metadata audit, errors or usage records.

## Design

- Share a narrow validated assistant-response normalizer between the two compatible adapters, retaining each adapter's existing identifiers, singleton checks and failure classification.
- Preserve absence versus explicit null refusal. Keep null acceptance bounded instead of accepting arbitrary empty upstream messages.
- Sources: installed OpenAI SDK completion declarations; [OpenRouter schema](https://openrouter.ai/openapi.json), ChatAssistantMessage and ChatFinishReasonEnum.
- No new product decisions; native blocked-response mappings remain deferred.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/refusal-outcomes.md).

## TDD plan

- Public HTTP and actual SDK cases first: null refusal and content_filter currently produce 502; textual refusal/filter signals currently disappear.
- Cover both adapters, both prefixes, usage and one upstream call, metadata secrecy, malformed null/refusal responses, implicit/explicit Deny, limits and unavailable required audit.
- Implement only normalized message and finish fields; run focused tests followed by npm run check.

## Delivery

- Add tests and record red; implement shared validation; record green; update contracts and run the full gate; publish ready PR.
- Risk: consumers must handle nullable content. Valid refusal delivery retains the existing successful-attempt audit classification; richer outcome metadata is deferred.
- Rollback restores old adapter normalization but reintroduces refusal incompatibility. Include red/green and full results in PR.

### Verification results

- Red: `node --experimental-strip-types test/refusal-outcomes.test.ts`: 6 failures, 2 passes; null/filter delivery, preserved refusal and malformed refusal rejection failed as expected.
- Green: same focused command: 8 passes.
- Integrated latest approved text-part support (PR #145); `npm run check`: 703 passes, 1 optional external PostgreSQL integration skipped, 0 failures. Typecheck, lint, planning/link/contracts/fixture checks and pinned schema integrity passed.
- Touched-file Biome check with `--error-on-warnings` and `git diff --check` passed.
