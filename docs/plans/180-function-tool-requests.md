# Function Tool Request Controls

## Issue and problem

- Issue: [#180](https://github.com/Theorvane/OpenGranter/issues/180).
- The gateway rejects official tool declaration and choice fields before OpenRouter-compatible clients can use them.

## Scope and expected behavior

- Accept non-streaming function-tool declarations, none/auto/required/named-function choice, and nullable parallel_tool_calls on both chat paths. Capture nested JSON schemas immutably before asynchronous work.
- Forward the supported controls to delegated OpenRouter and direct OpenAI. Direct Anthropic/Gemini reject supplied non-null controls before credential lookup. Omitted/null parallel control keeps native defaults.
- IAM, route, limits, metadata audit and usage attribution remain unchanged. Tool names, descriptions and schemas are never audit or error content.
- Tool-call responses, assistant/tool-result history, streaming, OpenRouter server tools and native Anthropic/Gemini tool mapping remain outside this issue and block end-to-end external-tool compatibility.

## Design

- Validate exact function-tool shapes and plain JSON schema values at the public and native boundaries. Reject cycles, unsupported object prototypes, non-finite values and excessive nesting; clone and freeze nested data. The 1 MiB HTTP body limit remains unchanged.
- Reject unsupported direct providers before secret lookup. Preserve upstream request field names without capability-aware model routing.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility matrix](../openrouter-compatibility.md) and [contract](../../contracts/client-function-tools.md). The current source-drift projection excludes these fields; future pin expansion is separate.
- Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), raw snapshot retrieved 2026-09-29. Server-tool variants are deliberately excluded.

## TDD plan

- First add HTTP, installed SDK and native tests showing current 400 rejection or missing native forwarding.
- Cover valid/omitted controls, malformed and server-tool rejection, unsupported direct providers, schema mutation during secret await, IAM/limit/audit denial and safe failed-attempt accounting.
- Implement a shared snapshot validator and minimal request forwarding, then run focused tests and `npm run check`.

## Delivery

- Deliver a ready issue-scoped PR with red/green and full-check evidence.
- Roll back validation/forwarding together. No stored-data migration; response guard remains active until tool-call lifecycle work is complete.

## Verification evidence

- Red: 11 initial HTTP/SDK/native/security tests failed before implementation because HTTP rejected valid controls or native calls silently dropped them; native malformed inputs did not reject.
- Green: 12 focused tests pass after implementing validation, immutable capture and forwarding. Extra cases cover omitted parallel defaults, simple tool choices and sparse/non-finite native schemas.
- Final `npm run check` passes: 886 tests pass and one optional external PostgreSQL test skips. Type checking, lint, planning checks and pinned compatibility integrity pass.
