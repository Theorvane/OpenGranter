# Client top_p sampling

## Issue and problem

- Issue: [#128](https://github.com/Theorvane/OpenGranter/issues/128), compatibility parent #116.
- External clients send top_p but the decoder rejects it and provider adapters omit its native fields.

## Scope and expected behavior

- Accept omitted or finite numeric top_p in the inclusive 0..1 range. Null, booleans, strings, objects, non-finite and out-of-range values reject.
- Map top_p unchanged for OpenRouter/OpenAI/Anthropic and generationConfig.topP for Gemini. Preserve stop and output maxima in the same request.
- Omission does not inject a default. Capture the primitive before asynchronous credential lookup.
- Preserve authentication, IAM, limits, required audit, usage and safe errors; no content or secrets enter operational records.
- Out of scope: temperature/other sampling options, trusted model capabilities, reasoning, tools and streaming.

## Design

- Add shared pure scalar validation at HTTP and adapter boundaries. Project only the validated known field and pass its captured value to native request construction.
- Do not clamp, drop, or substitute a supplied value. Some current Anthropic models restrict top_p; until capability metadata exists, existing upstream failure handling applies. No universal model-support claim is made.
- Update [contract](../../contracts/client-top-p.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility matrix](../openrouter-compatibility.md).
- No new domain term or costly architectural decision. Model-dependent supported parameters remain open under #116.

## TDD plan

- Four real adapters with fake transport: zero/one/fractional values, omission, invalid internal inputs before secret work and primitive mutation during credential lookup.
- Both HTTP paths: combined top_p/stop/output settings, required denial audit for malformed requests, implicit/explicit IAM denial, limit, audit failure and upstream rejection with usage accounting.
- Demonstrate missing mappings/rejection in red; implement minimal validation/mapping, run focused warning-free Biome and npm run check.

## Delivery

- No migration or live provider requests. Reverting restores clear unsupported-field rejection.
- Record red/green, full checks and remaining model-capability restrictions in the PR. Full OpenRouter compatibility remains incomplete.

## Verification evidence

- Red: 21 failures and one pass in the new 22-case public adapter/HTTP suite against the previous implementation.
- Green: all 22 cases pass after validation, immutable scalar capture and native mappings.
- npm run check passed: strict TypeScript, lint, 586 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
- Focused Biome with --error-on-warnings passed without warnings; git diff --check passed and CLAUDE.md remains a symbolic link to AGENTS.md.
- No live provider calls or credentials were used. Model-dependent capability restrictions and full external-client compatibility remain open.
