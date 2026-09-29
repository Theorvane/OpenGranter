# Leading developer text messages

## Issue and problem

- Issue: [#142](https://github.com/Theorvane/OpenGranter/issues/142), compatibility parent #116.
- The public gateway rejects developer role used by compatible clients. Adapter boundaries retain mutable caller message objects across secret lookup.

## Scope and expected behavior

- Extend the existing leading instruction prefix to string-content developer messages. OpenAI/OpenRouter retain roles/order/text; Anthropic joins leading instruction texts into system and Gemini maps the same joined text into systemInstruction.
- Snapshot validated immutable text messages before async work at HTTP and all adapter boundaries. Reject sparse/empty/malformed or unsupported message shapes before credentials/transport; do not leak contents in failures.
- Preserve existing prefix-only ordering, all-instruction native limitations, sampling/token fields, IAM, limits, required audit and usage. Developer is a message role, never an IAM authority or role assignment.
- Rich parts, tools, name/configuration_update fields, mid-conversation instructions and model-specific role negotiation remain open.

## Design

- A pure text-message boundary owns the role union and snapshot validation; re-export ChatMessage from the current gateway module to preserve type import compatibility.
- Use the same snapshot in gateway decoding and native adapters before secret lookup. Typed HTTP/internal messages remain text-only.
- Native OpenAI/OpenRouter accept developer roles; non-native providers have no separate developer channel. Extend the established instruction translation explicitly rather than dropping developer text or treating it as user content.
- Anthropic's [compatibility documentation](https://platform.claude.com/docs/en/api/openai-sdk) combines system/developer instructions. Gemini's [system instructions](https://ai.google.dev/gemini-api/docs/system-instructions) provide the instruction destination; separate system/developer priority is not preserved by this local mapping.
- See [contract](../../contracts/client-developer-messages.md); update PRD, architecture, acceptance and compatibility inventory. No new authentication, routing, content-audit or irreversible domain decision.

## TDD plan

- Public native regressions: mixed instruction prefix/order, mutation during secret lookup, malformed/late instructions rejected before credentials, and no regression in ordinary text turns.
- Both client paths plus actual pinned SDK: developer text reaches four native adapters with token/sampling controls and shared audit/usage. Verify IAM/limits/audit denial and safe upstream failure accounting without content exposure.
- Record red, implement smallest shared snapshot/mapping, green; strict TypeScript, focused warning-free Biome and full npm run check.

## Delivery

- No migration/dependency or real provider call. Document the prefix and priority restrictions; full external-tool compatibility remains blocked by #116.
- Update provenance/compatibility inventory when official referenced message schemas are covered by future conformance work.

## Verification evidence

- Red: nineteen new public adapter/HTTP/actual-SDK cases produced sixteen failures and three passes against the prior implementation, reproducing rejected developer calls and caller-owned message mutation.
- Green: all nineteen cases pass after the shared snapshot and native instruction mapping, including four providers, both SDK base paths, malformed/late instruction denial before secrets, immutable role/text capture and unchanged IAM/limits/audit/failed-usage behavior.
- Strict TypeScript, focused Biome with --error-on-warnings and diff checks pass. Final integrated npm run check remains the delivery gate before PR publication.
- Integrate reviewed schema-drift PR #139 from latest main without conflicts. Final npm run check passes: 684 tests pass, one optional external PostgreSQL case skipped, strict TypeScript/lint/planning/link/contract/fixture checks and offline schema integrity pass. No live provider inference or real credential was used.
