# Portable Response Formats

## Issue and problem

- Issue: [#154](https://github.com/Theorvane/OpenGranter/issues/154).
- SDK/client text and JSON-mode requests currently reject at the gateway because response_format is unknown.

## Scope and expected behavior

- Accept omission or exact {type: text/json_object}, immutable before awaits. Null, extra keys and all other formats reject before routing.
- OpenAI/OpenRouter forward the bounded field; Gemini maps to text/plain or application/json. Anthropic text uses its existing default; json_object fails before credential resolution/transport, with safe existing attempt/error accounting.
- Preserve IAM/limits/audit/usage. Do not rewrite prompts, silently drop requested JSON mode, widen routes, repair JSON or claim per-model support. Refusals/truncation retain existing response semantics. Strict JSON schema, model capability filtering/discovery and native Anthropic JSON generation remain deferred.

## Design

- Shared pure format snapshot at HTTP and native adapter boundaries. Add optional typed response_format to ChatRequest; adapter-specific native serialization follows existing control pipeline.
- Explicit rejection for unsupported Anthropic JSON mode is safer than prompting or pretending format enforcement. Route-wide capability selection remains unresolved; current selection may produce safe 502 for an unsupported direct adapter.
- Sources checked 2026-09-29: [OpenRouter parameters](https://openrouter.ai/docs/api-reference/parameters), [official schema](https://openrouter.ai/openapi.json) ChatFormatTextConfig/ChatFormatJsonObjectConfig, installed OpenAI SDK types and [Gemini generation config](https://ai.google.dev/api/generate-content).
- Native generation support is model-dependent; no new model capability policy is settled.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and [contract](../../contracts/client-response-formats.md).

## TDD plan

- HTTP/SDK format cases first: current gateway returns 400; native adapters currently ignore formats.
- Cover native payload mapping, omission/default parity, secret-await capture, strict malformed rejection, Anthropic unsupported JSON before secret, combined controls, implicit/explicit Deny/limits/audit and safe failed-provider accounting.
- Minimal shared validator and serializer additions; focused green, strict touched lint, full npm run check.

## Delivery

- Record red/green, full validation and limitations in ready PR.
- Risk: request mapping relies on supported upstream models and native output semantics; no local guarantee that truncated/refused completions contain a valid JSON object. Unsupported selected Anthropic routes fail rather than reroute.
- Rollback restores the unknown-field rejection.

### Verification evidence

- Red: `node --experimental-strip-types test/client-response-formats.test.ts`: 12 expected failures, 1 pass; native formats were ignored and HTTP/SDK fields rejected.
- Green: same command: 13 passes. Corrected test typing for intentionally invalid native inputs and confirmed existing pre-transport accounting produces no fabricated usage row.
- `npm run check`: 732 passes, 1 optional external PostgreSQL integration skipped, 0 failures; all strict type/lint/document/link/contract/fixture/schema gates passed.
- Touched-file lint with warnings as errors and whitespace checks passed. Native-format request mapping does not imply universal model or output-schema support.

### Approved refusal integration

- Integrated merged PR #153 without conflicts. `npm run check`: 738 passes, 1 optional external PostgreSQL integration skipped, 0 failures; all gates passed.
- Updated head awaits current CI/review; the original response-format implementation and red/green behavior remain unchanged.
