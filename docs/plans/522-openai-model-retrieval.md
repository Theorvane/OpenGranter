# OpenAI SDK model retrieval

## Issue and problem

- Issue: [#522](https://github.com/Theorvane/OpenGranter/issues/522), part of #116.
- Installed OpenAI 7.23.0 models.retrieve(id) uses GET /models/{model} and returns a bare model object. Current listing works, but this separate workflow returns404. OpenRouter models.get uses a singular path and wrapped rich response.

## Scope and expected behavior

- Add GET /v1/models/{model} and /api/v1/models/{model} with one encoded model parameter. Return the exact published alias's listing projection as a bare model object. Both basic and rich aliases work; legacy projection remains basic and compatible projection preserves published rich metadata when present.
- Reuse full catalog validation/capture, enabled model/final-provider IAM and required model-read audit with count0/1. Unknown/disabled/inaccessible aliases share private404. Do not follow canonical_slug, alias_target or links, or reach routing, inference, secret, limit or accounting ports.
- Preserve the existing singular OpenRouter metadata requirement/wrapper and all collection operations. The compatible count path has precedence; a same-named count alias can be retrieved only on /v1. Reject alternate percent encodings of that reserved compatible ID after authentication.
- Local restrictions: one nonempty wire segment, at most4,608 encoded units and512 decoded UTF-16 units; decode once, permit embedded alias slashes but reject empty/dot/dot-dot decoded components, whitespace/C0/DEL/C1 and percent/backslash/question/hash. Literal extra/trailing path segments remain unsupported404. Nonempty queries reject400 after authentication and before catalog access. Do not read request bodies. Every recognized response and Node fallback is no-store.
- No new audit kinds, database migrations, provider capabilities or price/accounting behavior.

## Design

- Add a narrow OpenAI path classifier/parser alongside the existing singular parser. Share classification with the discovery cache boundary; method gating remains at the gateway. Treat decoded IDs only as catalog keys, never URL/routing authority.
- Generalize the existing single-model flow with an explicit OpenAI shape distinction. Capture output before awaiting audit. Require rich metadata only for the OpenRouter singular operation.
- Official [retrieve reference](https://developers.openai.com/api/reference/resources/models/methods/retrieve), fetched2026-10-24, establishes GET /models/{model} and a bare Model. Installed SDK sources establish encoding of slash/question/hash inside one parameter. Local syntax/length/count restrictions are explicit, not asserted upstream constraints.
- Update product, architecture, acceptance, compatibility, discovery cache and single-model contracts. Existing five OpenRouter structural pins remain unchanged and do not cover this separate OpenAI operation. No new domain term or consequential architectural trade-off requires glossary/ADR changes.
- Open decisions: none for this bounded exact-publication extension. Broader #116, unresolved #7, other OpenAI APIs and metadata provisioning remain open.

## TDD plan

- First add raw Fetch and installed OpenAI socket retrieval cases and record404 failures before implementation. Include basic/rich/slash/variant/Unicode aliases, both bases and route kinds, fresh policy and output parity with listing.
- Cover implicit/explicit model/provider Deny and disabled/unknown equivalence, invalid query/encoding/component/bounds, authentication and audit failures, malformed hidden catalogs, mutation during audit and content-free metadata/history.
- Preserve OpenRouter singular get via existing actual SDK tests, and assert compatible count precedence and encoded reserved-ID rejection. Raw nested paths and unrelated cache behavior remain unchanged.
- Run focused public-boundary/sanitizer/SDK suites, strict types/lint and npm run check. Use the documented scheduling workaround only if needed; retain every test and timeout.

## Delivery

- Commit on the fresh issue branch with authorized identity, Assisted-by and DCO. Open a ready PR linking this plan and red/green evidence; require approval of its current head and successful CI before merge.
- Risks: proxies must preserve encoded slash parameters; local alias syntax and reserved count are compatibility restrictions. This adds no upstream lookup or model existence authority. Reverting path support restores404 without a migration.
- Record actual red/green/full validation below before PR delivery. Update the agent handoff with this new checkpoint so continuation does not rely on the previous snapshot.

## Verification evidence

- Red: all 18 new Fetch/installed OpenAI regression cases failed with the expected unsupported retrieval404 before production edits. Evidence: /tmp/opengranter-522-red.log.
- Green: all 18 passed after the minimal parser/shared-flow change. Ten focused raw/installed-SDK/count/cache/single-model/audit/error suites then passed all 96 cases. Evidence: /tmp/opengranter-522-green.log and /tmp/opengranter-522-focused.log. Existing OpenRouter get and shared audit storage/history regressions remained green.
- Updated two old unsupported-neighbor assertions because /v1/models/count is now a supported exact model path; replaced them with a genuinely unsupported nested path and added explicit count-alias/compatible-count-precedence coverage. No existing count response or singular lookup behavior was weakened.
- The local dependency directory was incomplete; npm ci restored the committed dependency set without a manifest/lockfile change. Strict type checking and lint then passed. Existing repository lint warnings/infos were not changed.
- Full `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 6,978 cases, 6,977 passed, one optional external PostgreSQL skip, zero failures/cancellations. Every original test/deadline remained enabled. Types, lint, planning/link/contract/fixture-secret checks and all five offline structural integrity checks passed. Evidence: /tmp/opengranter-522-check.log.
- Existing OpenRouter pin bytes, migrations and dependency files have no diff. No live provider requests or broader OpenRouter/OpenAI certification were added. Documentation review clarified the legacy count path in its own contract, and document/link checks were repeated after recording these results.
